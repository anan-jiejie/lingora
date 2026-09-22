/* ==========================================================================
   mailer.js —— 极简 SMTP 客户端（零依赖，只用 node:tls / node:net）
   ==========================================================================
   为什么手写而不用 nodemailer：
   整个后端坚持零 npm 依赖 —— 免安装、免联网拉包、打包体积最小，
   在受限网络环境里也能直接部署。这里只需要「发一封纯文本信」这一件事。

   支持两种连接方式（按端口自动判断）：
   · 465 → 隐式 TLS（连上就是加密通道）
   · 587 / 25 → 明文连接后 STARTTLS 升级

   认证方式：AUTH LOGIN（QQ 邮箱 / 163 / Gmail / Outlook 都支持）

   未配置 SMTP_HOST 时，isConfigured() 返回 false，
   上层会走「服务端演示码」通道，而不是报错。
   ========================================================================== */
'use strict';

const tls = require('node:tls');
const crypto = require('node:crypto');

const CONNECT_TIMEOUT_MS = 12000;
const READ_TIMEOUT_MS = 15000;

function env(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

function config() {
  return {
    host: env('SMTP_HOST', 'LINGORA_SMTP_HOST'),
    port: Number(env('SMTP_PORT', 'LINGORA_SMTP_PORT') || 465),
    user: env('SMTP_USER', 'LINGORA_SMTP_USER'),
    pass: env('SMTP_PASS', 'LINGORA_SMTP_PASS'),
    from: env('SMTP_FROM', 'LINGORA_SMTP_FROM') || env('SMTP_USER', 'LINGORA_SMTP_USER'),
    fromName: env('SMTP_FROM_NAME', 'LINGORA_SMTP_FROM_NAME') || 'Lingora'
  };
}

const isConfigured = () => {
  const c = config();
  return !!(c.host && c.port && c.user && c.pass);
};

/* ---------- 邮件内容构造 ---------- */

const b64head = (s) => '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';

const foldBase64 = (s) => (String(s).match(/.{1,76}/g) || []).join('\r\n');

function buildMessage(c, to, subject, text) {
  const lines = [
    'From: ' + b64head(c.fromName) + ' <' + c.from + '>',
    'To: <' + to + '>',
    'Subject: ' + b64head(subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@lingora.local>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(String(text), 'utf8').toString('base64'))
  ];
  return lines.join('\r\n');
}

/* ---------- SMTP 会话 ---------- */

class Session {
  constructor(socket) {
    this.sock = socket;
    this.buf = '';
    this.waiters = [];
    this.closed = false;
    this.sock.setEncoding('utf8');
    this.sock.on('data', (chunk) => {
      this.buf += chunk;
      this.drain();
    });
    this.sock.on('error', (err) => this.fail(err));
    this.sock.on('close', () => this.fail(new Error('SMTP 连接被关闭')));
  }

  fail(err) {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift().rej(err);
  }

  /* SMTP 多行响应：连续行用 "250-" 续行，最后一行用 "250 " 结束 */
  drain() {
    const m = this.buf.match(/^(?:[0-9]{3}-[^\r\n]*\r\n)*[0-9]{3}[^\r\n]*\r\n/);
    if (!m) return;
    const reply = this.buf.slice(0, m[0].length);
    this.buf = this.buf.slice(m[0].length);
    const w = this.waiters.shift();
    if (w) w.res(reply);
    if (this.waiters.length) this.drain();
  }

  read() {
    if (this.closed) return Promise.reject(new Error('SMTP 会话已结束'));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('SMTP 读取超时')), READ_TIMEOUT_MS);
      this.waiters.push({
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); }
      });
      this.drain();
    });
  }

  write(line) {
    this.sock.write(line + '\r\n');
  }

  /* 发送命令并断言响应码是期望值 */
  async cmd(line, expect, label) {
    this.write(line);
    const reply = await this.read();
    const code = reply.slice(0, 3);
    if (expect && !expect.includes(code)) {
      throw new Error('SMTP ' + (label || line.split(' ')[0]) + ' 失败：' + reply.trim());
    }
    return reply;
  }

  async upgradeTls(host) {
    /* 摘掉旧 socket 的监听，把底层流交给 tls 接管 */
    const raw = this.sock;
    raw.removeAllListeners('data');
    raw.removeAllListeners('error');
    raw.removeAllListeners('close');
    const secured = await new Promise((res, rej) => {
      const t = tls.connect({ socket: raw, servername: host }, () => res(t));
      t.once('error', rej);
    });
    return new Session(secured);
  }

  end() {
    try { this.sock.end(); } catch (_) { /* noop */ }
  }
}

function connect(host, port, implicitTls) {
  return new Promise((res, rej) => {
    const onReady = (sock) => res(new Session(sock));
    const sock = implicitTls
      ? tls.connect({ host: host, port: port, servername: host }, () => onReady(sock))
      : require('node:net').connect({ host: host, port: port }, () => onReady(sock));

    const timer = setTimeout(() => {
      try { sock.destroy(); } catch (_) { /* noop */ }
      rej(new Error('SMTP 连接超时（' + host + ':' + port + '）'));
    }, CONNECT_TIMEOUT_MS);

    sock.once('error', (e) => { clearTimeout(timer); rej(e); });
    sock.once('secureConnect', () => clearTimeout(timer));
    sock.once('connect', () => { if (!implicitTls) clearTimeout(timer); });
  });
}

/* ---------- 对外接口 ---------- */

/* 发一封纯文本邮件。抛错即发送失败 */
async function send(to, subject, text) {
  const c = config();
  if (!isConfigured()) throw new Error('SMTP 未配置');

  const implicitTls = c.port === 465;
  let s = await connect(c.host, c.port, implicitTls);

  try {
    await s.read();                                  /* 220 问候 */
    await s.cmd('EHLO lingora.local', ['250'], 'EHLO');

    if (!implicitTls) {
      await s.cmd('STARTTLS', ['220'], 'STARTTLS');
      s = await s.upgradeTls(c.host);
      await s.cmd('EHLO lingora.local', ['250'], 'EHLO(TLS)');
    }

    await s.cmd('AUTH LOGIN', ['334'], 'AUTH');
    await s.cmd(Buffer.from(c.user, 'utf8').toString('base64'), ['334'], 'AUTH-USER');
    await s.cmd(Buffer.from(c.pass, 'utf8').toString('base64'), ['235'], 'AUTH-PASS');

    await s.cmd('MAIL FROM:<' + c.from + '>', ['250'], 'MAIL FROM');
    await s.cmd('RCPT TO:<' + to + '>', ['250', '251'], 'RCPT TO');
    await s.cmd('DATA', ['354'], 'DATA');

    s.sock.write(buildMessage(c, to, subject, text) + '\r\n.\r\n');
    const done = await s.read();
    if (done.slice(0, 3) !== '250') throw new Error('SMTP DATA 被拒：' + done.trim());

    try { await s.cmd('QUIT', ['221'], 'QUIT'); } catch (_) { /* 服务端可能直接断连，不影响投递 */ }
    return true;
  } finally {
    s.end();
  }
}

module.exports = { send: send, isConfigured: isConfigured, config: config };
