/* ==========================================================================
   store.js —— 内存态存储：验证码请求 / 会话 / 限流
   ==========================================================================
   为什么用内存而不是数据库：
   · 这个站是单实例部署，数据量极小（每分钟个位数请求）
   · 零依赖、零配置，进程重启即清空 —— 对演示/小规模生产足够
   · 需要水平扩展或多实例时，把下面三个 Map 换成 Redis 即可，接口不变

   安全约定：
   · 一次性验证码只存 sha256 摘要，不存明文
   · 会话 token 只存 sha256(token)，即使内存被 dump 也无法直接复用
   · 会话有效性一律以服务端为准，前端 Cookie 只是凭据载体
   ========================================================================== */
'use strict';

const crypto = require('node:crypto');

const CODE_TTL_MS = 5 * 60 * 1000;      /* 一次性验证码有效期 */
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; /* 会话 7 天 */
const RESEND_COOLDOWN_MS = 60 * 1000;   /* 同一目标 60s 内不可重发 */
const IP_WINDOW_MS = 60 * 60 * 1000;    /* IP 限流窗口 1 小时 */
const IP_MAX_SENDS = 20;                /* 窗口内最多发 20 次 */
const MAX_CODE_TRIES = 5;               /* 一个验证码最多试 5 次 */

/* requestId -> { target, channel, region, codeHash, expireAt, triesLeft } */
const codeRequests = new Map();
/* sha256(token) -> { target, region, at, expireAt } */
const sessions = new Map();
/* targetKey -> 上次发送时间戳 */
const lastSent = new Map();
/* ip -> number[] 发送时间戳数组 */
const ipSends = new Map();

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = (bytes) => crypto.randomBytes(bytes || 32).toString('hex');
const now = () => Date.now();

/* 定时清理 */
const sweeper = setInterval(() => {
  const t = now();
  for (const [k, v] of codeRequests) if (v.expireAt <= t) codeRequests.delete(k);
  for (const [k, v] of sessions) if (v.expireAt <= t) sessions.delete(k);
  for (const [k, v] of lastSent) if (t - v > RESEND_COOLDOWN_MS * 10) lastSent.delete(k);
  for (const [k, arr] of ipSends) {
    const keep = arr.filter((x) => t - x < IP_WINDOW_MS);
    if (keep.length) ipSends.set(k, keep);
    else ipSends.delete(k);
  }
}, 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

/* ---------- 限流 ---------- */

/* 发送前检查。返回 { ok, reason, retryAfter } */
function checkSend(targetKey, ip) {
  const t = now();

  const last = lastSent.get(targetKey);
  if (last && t - last < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      reason: 'TOO_FAST',
      retryAfter: Math.ceil((RESEND_COOLDOWN_MS - (t - last)) / 1000)
    };
  }

  const arr = (ipSends.get(ip) || []).filter((x) => t - x < IP_WINDOW_MS);
  if (arr.length >= IP_MAX_SENDS) {
    return { ok: false, reason: 'IP_LIMITED', retryAfter: Math.ceil(IP_WINDOW_MS / 1000) };
  }

  return { ok: true };
}

function markSent(targetKey, ip) {
  const t = now();
  lastSent.set(targetKey, t);
  const arr = ipSends.get(ip) || [];
  arr.push(t);
  ipSends.set(ip, arr);
}

/* ---------- 一次性验证码 ---------- */

function putCode(opts) {
  const requestId = token(16);
  codeRequests.set(requestId, {
    target: opts.target,
    channel: opts.channel,
    region: opts.region,
    codeHash: sha256(opts.code),
    expireAt: now() + CODE_TTL_MS,
    triesLeft: MAX_CODE_TRIES
  });
  return requestId;
}

/* 校验一个请求对应的验证码。返回 { ok, reason, record } */
function verifyCode(requestId, code) {
  const key = String(requestId || '');
  const rec = codeRequests.get(key);

  if (!rec || rec.expireAt <= now()) {
    codeRequests.delete(key);
    return { ok: false, reason: 'CODE_EXPIRED' };
  }

  const got = sha256(String(code || '').trim());

  if (got === rec.codeHash) {
    codeRequests.delete(key); /* 一次性：登录成功后不可重放 */
    return { ok: true, reason: 'OK', record: rec };
  }

  rec.triesLeft -= 1;
  if (rec.triesLeft <= 0) {
    codeRequests.delete(key);
    return { ok: false, reason: 'CODE_LOCKED' };
  }
  return { ok: false, reason: 'CODE_BAD', triesLeft: rec.triesLeft };
}

/* 取一条记录（用于校验 target 是否被中途替换） */
function peekCode(requestId) {
  const rec = codeRequests.get(String(requestId || ''));
  if (!rec || rec.expireAt <= now()) return null;
  return rec;
}

/* ---------- 会话 ---------- */

function createSession(info) {
  const raw = token(32);
  sessions.set(sha256(raw), {
    target: info.target,
    channel: info.channel,
    region: info.region,
    referral: info.referral || null,
    at: new Date().toISOString(),
    expireAt: now() + SESSION_TTL_MS
  });
  return raw;
}

function getSession(raw) {
  if (!raw) return null;
  const key = sha256(raw);
  const rec = sessions.get(key);
  if (!rec) return null;
  if (rec.expireAt <= now()) {
    sessions.delete(key);
    return null;
  }
  return rec;
}

function destroySession(raw) {
  if (!raw) return false;
  return sessions.delete(sha256(raw));
}

module.exports = {
  checkSend: checkSend,
  markSent: markSent,
  putCode: putCode,
  verifyCode: verifyCode,
  peekCode: peekCode,
  createSession: createSession,
  getSession: getSession,
  destroySession: destroySession,
  SESSION_TTL_MS: SESSION_TTL_MS,
  CODE_TTL_MS: CODE_TTL_MS,
  RESEND_COOLDOWN_MS: RESEND_COOLDOWN_MS
};
