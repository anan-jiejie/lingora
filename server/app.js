/* ==========================================================================
   app.js —— Lingora 账户后端（零依赖 Node HTTP 服务）
   ==========================================================================
   一个进程同时干两件事：
     1) 提供前端静态文件（index / login / register / app / assets）
     2) 提供 /api/* 接口（图形验证码、验证码下发、登录、会话、退出）

   为什么前端和后端做成同源：
     会话用 HttpOnly Cookie 承载，同源才能天然生效，不需要跨域放行、
     不需要 CORS 白名单、也不会有 SameSite 的灰色地带。

   关于登录（按需求已撤除门禁）：
     工具页 /app.html 是公开的 —— 不登录也能打开、也能正常使用。
     登录只影响顶栏是否显示账号与「退出登录」按钮，
     不拦截任何页面、不影响任何功能。前端也不做强制跳转。

   运行：
     node server/app.js                 # 默认 http://127.0.0.1:8787
     PORT=8080 node server/app.js

   环境变量（全部可选）：
     PORT                 监听端口，默认 8787
     HOST                 监听地址，默认 0.0.0.0
     COOKIE_SECURE        1 = Cookie 加 Secure（HTTPS 部署时设）
     DEMO_MODE            off = 关闭演示码通道（生产建议关，改为配 SMTP）
     SMTP_HOST/PORT/USER/PASS/FROM/FROM_NAME
     SMS_WEBHOOK_URL      POST {phone, code} 即可接入任何短信网关
     SMS_WEBHOOK_TOKEN    作为 Authorization: Bearer 发送
   ========================================================================== */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const captcha = require('./lib/captcha');
const store = require('./lib/store');
const mailer = require('./lib/mailer');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_NAME = 'lingora_sid';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'
  || /^https:/i.test(process.env.PUBLIC_ORIGIN || '');
const DEMO_MODE = String(process.env.DEMO_MODE || 'on').toLowerCase() !== 'off';
const MAX_BODY = 16 * 1024;

/* 不允许被静态服务暴露的路径前缀（源码、Git 元数据、本地验证产物） */
const BLOCKED_PREFIXES = ['/server', '/.git', '/.verify', '/node_modules', '/.workbuddy'];
const BLOCKED_FILES = ['/.gitignore', '/.gitattributes', '/.nojekyll'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.onnx': 'application/octet-stream'
};

/* ==================================================================
   小工具
   ================================================================== */

const clientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
};

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(value, maxAgeSec, secure) {
  const bits = [
    COOKIE_NAME + '=' + value,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSec
  ];
  if (secure == null ? COOKIE_SECURE : secure) bits.push('Secure');
  return bits.join('; ');
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || MAX_BODY)) {
        reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function json(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/x-www-form-urlencoded')) {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    return out;
  }
  try { return JSON.parse(raw); } catch (_) { return null; }
}

/* 同源校验：SameSite=Lax 已经挡住绝大多数跨站 POST，
   这里再加一道 Origin 检查，避免边缘场景下被带 Cookie 发请求 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; /* 同源表单 / 命令行调用不带 Origin */
  const host = req.headers.host;
  try {
    return url.parse(origin).host === host;
  } catch (_) {
    return false;
  }
}

/* ==================================================================
   验证码下发：SMTP → 短信 Webhook → 服务端演示码（三级降级）
   ================================================================== */

async function deliverCode(opts) {
  const { channel, target, code } = opts;

  if (channel === 'email') {
    if (mailer.isConfigured()) {
      await mailer.send(
        target,
        'Lingora 登录验证码',
        [
          '你的登录验证码是：' + code,
          '',
          '验证码 5 分钟内有效，仅可使用一次。',
          '如果不是你本人操作，忽略这封邮件即可。',
          '',
          'Lingora · 在线语音转写工具'
        ].join('\r\n')
      );
      return { deliveredBy: 'smtp' };
    }
    return { deliveredBy: 'demo' };
  }

  /* 手机通道 */
  const hook = process.env.SMS_WEBHOOK_URL;
  if (hook) {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.SMS_WEBHOOK_TOKEN) {
      headers.Authorization = 'Bearer ' + process.env.SMS_WEBHOOK_TOKEN;
    }
    const r = await fetch(hook, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: target, code: code, scene: 'lingora_login' })
    });
    if (!r.ok) throw new Error('短信网关返回 ' + r.status);
    return { deliveredBy: 'sms' };
  }

  return { deliveredBy: 'demo' };
}

/* ==================================================================
   API 路由
   ================================================================== */

const sixDigit = () => String(require('node:crypto').randomInt(100000, 1000000));

const phoneOk = (v) => /^1[3-9]\d{9}$/.test(String(v || ''));
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

function sessionOf(req) {
  const raw = parseCookies(req)[COOKIE_NAME];
  return store.getSession(raw);
}

/* 统一的错误码 → 前端文案映射放在前端；这里只给机器可读的 error */
const api = {

  /* GET /api/health —— 部署自检 */
  'GET /api/health': (req, res) => {
    sendJson(res, 200, {
      ok: true,
      service: 'lingora-account',
      now: new Date().toISOString(),
      smtp: mailer.isConfigured(),
      sms: !!process.env.SMS_WEBHOOK_URL,
      demoMode: DEMO_MODE
    });
  },

  /* GET /api/session —— 前端查询当前登录态 */
  'GET /api/session': (req, res) => {
    const s = sessionOf(req);
    if (!s) {
      sendJson(res, 200, { ok: true, authed: false });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      authed: true,
      target: s.target,
      channel: s.channel,
      region: s.region,
      referral: s.referral,
      at: s.at
    });
  },

  /* GET /api/captcha/new —— 申请一张图形验证码 */
  'GET /api/captcha/new': (req, res) => {
    const c = captcha.create();
    sendJson(res, 200, {
      ok: true,
      captchaId: c.id,
      imageUrl: '/api/captcha/' + c.id + '.svg',
      expiresIn: c.expiresIn
    });
  },

  /* POST /api/code/send —— 校验图形码 → 下发 6 位验证码 */
  'POST /api/code/send': async (req, res) => {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'BAD_ORIGIN' });
      return;
    }
    const body = await json(req);
    if (!body) {
      sendJson(res, 400, { ok: false, error: 'BAD_JSON' });
      return;
    }

    /* 1) 图形验证码 */
    const cap = captcha.verify(body.captchaId, body.captchaText);
    if (!cap.ok) {
      sendJson(res, 400, {
        ok: false,
        error: cap.reason === 'BAD_ID' ? 'CAPTCHA_EXPIRED' : 'CAPTCHA_BAD',
        captchaFailed: true
      });
      return;
    }

    /* 2) 目标校验 */
    const channel = body.channel === 'email' ? 'email' : 'phone';
    const region = body.region === 'intl' ? 'intl' : 'cn';
    const target = channel === 'phone'
      ? String(body.target || '').replace(/\D+/g, '')
      : String(body.target || '').trim().toLowerCase();

    if (channel === 'phone' && !phoneOk(target)) {
      sendJson(res, 400, { ok: false, error: 'TARGET_BAD' });
      return;
    }
    if (channel === 'email' && !emailOk(target)) {
      sendJson(res, 400, { ok: false, error: 'TARGET_BAD' });
      return;
    }

    /* 3) 限流 */
    const ip = clientIp(req);
    const key = channel + ':' + target;
    const gate = store.checkSend(key, ip);
    if (!gate.ok) {
      sendJson(res, 429, {
        ok: false,
        error: gate.reason,
        retryAfter: gate.retryAfter
      });
      return;
    }

    /* 4) 生成并投递 */
    const code = sixDigit();
    let deliveredBy;
    try {
      const r = await deliverCode({ channel, target, code });
      deliveredBy = r.deliveredBy;
    } catch (err) {
      sendJson(res, 502, { ok: false, error: 'DELIVER_FAILED', detail: String(err.message || err) });
      return;
    }

    /* 演示通道：没有真实投递能力时，把码回给页面
       ⚠️ 必须 DEMO_MODE=on 才回；生产环境配好 SMTP / 短信后应设为 off */
    if (deliveredBy === 'demo' && !DEMO_MODE) {
      sendJson(res, 503, { ok: false, error: 'NO_CHANNEL' });
      return;
    }

    const requestId = store.putCode({ target, channel, region, code });
    store.markSent(key, ip);

    const payload = {
      ok: true,
      requestId: requestId,
      channel: channel,
      masked: channel === 'phone'
        ? target.slice(0, 3) + '****' + target.slice(-4)
        : target.replace(/^(.).*(@.*)$/, '$1***$2'),
      deliveredBy: deliveredBy,
      ttl: Math.floor(store.CODE_TTL_MS / 1000),
      cooldown: Math.floor(store.RESEND_COOLDOWN_MS / 1000)
    };
    if (deliveredBy === 'demo') {
      payload.demo = true;
      payload.devCode = code;
    }
    sendJson(res, 200, payload);
  },

  /* POST /api/login —— 校验 6 位码 → 下发会话 Cookie */
  'POST /api/login': async (req, res) => {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'BAD_ORIGIN' });
      return;
    }
    const body = await json(req);
    if (!body) {
      sendJson(res, 400, { ok: false, error: 'BAD_JSON' });
      return;
    }

    if (!body.agree) {
      sendJson(res, 400, { ok: false, error: 'NEED_AGREE' });
      return;
    }

    const channel = body.channel === 'email' ? 'email' : 'phone';
    const target = channel === 'phone'
      ? String(body.target || '').replace(/\D+/g, '')
      : String(body.target || '').trim().toLowerCase();

    const rec = store.peekCode(body.requestId);
    if (!rec) {
      sendJson(res, 400, { ok: false, error: 'CODE_EXPIRED' });
      return;
    }
    /* 目标不能在中途被换掉：换了手机号就必须重新获取验证码 */
    if (rec.target !== target) {
      sendJson(res, 400, { ok: false, error: 'TARGET_CHANGED' });
      return;
    }

    const check = store.verifyCode(body.requestId, body.code);
    if (!check.ok) {
      sendJson(res, 400, {
        ok: false,
        error: check.reason,
        triesLeft: check.triesLeft
      });
      return;
    }

    const referral = String(body.referral || '').trim().toUpperCase() || null;
    const region = body.region === 'intl' ? 'intl' : 'cn';
    const raw = store.createSession({ target, channel, region, referral });

    sendJson(res, 200, {
      ok: true,
      authed: true,
      target: target,
      region: region,
      referral: referral,
      at: new Date().toISOString()
    }, {
      'Set-Cookie': cookieHeader(raw, Math.floor(store.SESSION_TTL_MS / 1000))
    });
  },

  /* POST /api/logout */
  'POST /api/logout': (req, res) => {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'BAD_ORIGIN' });
      return;
    }
    const raw = parseCookies(req)[COOKIE_NAME];
    store.destroySession(raw);
    sendJson(res, 200, { ok: true }, {
      'Set-Cookie': cookieHeader('', 0, false)
    });
  }
};

/* ==================================================================
   静态文件
   ================================================================== */

function resolveStatic(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return null; }
  if (rel === '/' || rel === '') rel = '/index.html';

  for (const p of BLOCKED_PREFIXES) {
    if (rel === p || rel.startsWith(p + '/')) return null;
  }
  if (BLOCKED_FILES.includes(rel)) return null;
  if (rel.includes('\u0000')) return null;

  const full = path.resolve(ROOT, '.' + rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function serveStatic(req, res, pathname) {
  let file = resolveStatic(pathname);
  if (!file) {
    sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
    return;
  }

  let stat = null;
  try { stat = fs.statSync(file); } catch (_) { stat = null; }
  if (stat && stat.isDirectory()) {
    file = path.join(file, 'index.html');
    try { stat = fs.statSync(file); } catch (_) { stat = null; }
  }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><title>404</title>'
      + '<body style="font:15px/1.6 system-ui;padding:60px;color:#080D18">'
      + '<h1 style="font-size:22px">404 · 页面不存在</h1>'
      + '<p><a href="/" style="color:#0E9C7A">回到首页</a></p>');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString()
  };
  /* HTML 永远不缓存，避免部署后仍看到旧的门禁逻辑 */
  headers['Cache-Control'] = ext === '.html' ? 'no-cache' : 'public, max-age=3600';

  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

/* ==================================================================
   请求入口
   ================================================================== */

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';
  const route = req.method + ' ' + pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  try {
    /* ---------- 图形验证码图片（GET /api/captcha/<id>.svg） ---------- */
    const capMatch = pathname.match(/^\/api\/captcha\/([a-f0-9]{32})\.svg$/);
    if (capMatch && req.method === 'GET') {
      const svg = captcha.image(capMatch[1]);
      if (!svg) {
        res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('captcha expired');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Length': svg.length
      });
      res.end(svg);
      return;
    }

    /* ---------- API ---------- */
    if (pathname.startsWith('/api/')) {
      const handler = api[route];
      if (!handler) {
        sendJson(res, 404, { ok: false, error: 'NO_SUCH_API', route: route });
        return;
      }
      await handler(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    /* ---------- 静态 ----------
       工具页（/app.html）是公开的：不需要登录就能打开、就能用。
       登录只影响顶栏是否显示账号与退出按钮，不构成任何门槛。 */

    /* /app 只是 /app.html 的短链接别名（无任何鉴权），
       保留它是因为这个地址以前就能用，不该因为撤门禁而变成 404。 */
    if (pathname === '/app') {
      res.writeHead(302, { Location: '/app.html', 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    if (err && err.code === 'TOO_LARGE') {
      sendJson(res, 413, { ok: false, error: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    console.error('[error]', route, err && err.stack ? err.stack : err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'INTERNAL' });
  }
});

server.listen(PORT, HOST, () => {
  const c = mailer.config();
  console.log('Lingora 账户服务已启动');
  console.log('  本机地址   http://127.0.0.1:' + PORT + '/');
  console.log('  监听       ' + HOST + ':' + PORT);
  console.log('  静态根目录 ' + ROOT);
  console.log('  SMTP       ' + (mailer.isConfigured() ? (c.host + ':' + c.port + ' as ' + c.user) : '未配置（邮箱验证码将走演示通道）'));
  console.log('  短信网关   ' + (process.env.SMS_WEBHOOK_URL || '未配置'));
  console.log('  演示模式   ' + (DEMO_MODE ? '开启（验证码会显示在页面上）' : '关闭'));
  console.log('  Cookie     HttpOnly + SameSite=Lax' + (COOKIE_SECURE ? ' + Secure' : ''));
});

const bye = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
