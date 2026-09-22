/* ==========================================================================
   smoke.js —— 账户后端端到端冒烟测试
   ==========================================================================
   用法：node server/test/smoke.js

   为什么能取出图形验证码答案：
   测试脚本与 app.js 跑在同一个 Node 进程里，require 到的是同一份 captcha
   模块实例，所以可以用 _peekForTest() 读到答案来完成正向流程断言。
   这条通道只存在于进程内部，没有任何 HTTP 接口能拿到答案。
   ========================================================================== */
'use strict';

const http = require('node:http');

process.env.PORT = process.env.TEST_PORT || '8790';
process.env.HOST = '127.0.0.1';
process.env.DEMO_MODE = 'on';

const BASE = 'http://127.0.0.1:' + process.env.PORT;

const app = require('../app');
const captcha = require('../lib/captcha');

let pass = 0;
let fail = 0;
const lines = [];

function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    lines.push('  \u2713 ' + name);
  } else {
    fail += 1;
    lines.push('  \u2717 ' + name + (extra === undefined ? '' : '   → ' + JSON.stringify(extra)));
  }
}

function section(title) {
  lines.push('');
  lines.push(title);
}

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const u = new URL(BASE + path);
    const r = http.request({
      method: method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: Object.assign(
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
        headers || {}
      )
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch (_) { json = null; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buf: buf,
          text: buf.toString('utf8'),
          json: json
        });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 从 Set-Cookie 里取出 lingora_sid=xxx 并拼成后续请求的 Cookie 头 */
function cookieOf(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const m = String(c).match(/lingora_sid=([^;]*)/);
    if (m) return 'lingora_sid=' + m[1];
  }
  return '';
}

const PHONE = '13800138000';
const EMAIL = 'demo@lingora.test';

async function newCaptcha() {
  const r = await req('GET', '/api/captcha/new');
  const id = r.json && r.json.captchaId;
  return { res: r, id: id, answer: id ? captcha._peekForTest(id) : null };
}

async function main() {
  await sleep(300);

  /* =============== 1. 基础接口 =============== */
  section('1. 基础接口');
  const health = await req('GET', '/api/health');
  ok('GET /api/health 返回 200', health.status === 200, health.status);
  ok('健康检查里能看到投递通道状态', health.json && 'smtp' in health.json && 'sms' in health.json, health.json);

  const sess0 = await req('GET', '/api/session');
  ok('未登录时 /api/session 返回 authed:false', sess0.json && sess0.json.authed === false, sess0.json);

  const blocked = await req('GET', '/server/app.js');
  ok('静态服务不暴露 server/ 源码', blocked.status === 404, blocked.status);

  const gitBlocked = await req('GET', '/.gitignore');
  ok('静态服务不暴露 .gitignore', gitBlocked.status === 404, gitBlocked.status);

  const traversal = await req('GET', '/assets/../../app.js');
  ok('路径穿越被拒绝', traversal.status === 404, traversal.status);

  /* =============== 2. 图形验证码 =============== */
  section('2. 图形验证码');
  const c1 = await newCaptcha();
  ok('能申请到图形验证码', !!c1.id && !!c1.answer, c1.id);
  ok('答案长度为 4', c1.answer && c1.answer.length === 4, c1.answer);

  const img = await req('GET', c1.res.json.imageUrl);
  ok('验证码图片返回 200', img.status === 200, img.status);
  ok('Content-Type 是 image/png', String(img.headers['content-type']).indexOf('image/png') === 0, img.headers['content-type']);
  const sig = img.buf.slice(0, 8).toString('hex');
  ok('确实是合法 PNG（魔数校验）', sig === '89504e470d0a1a0a', sig);
  ok('图片体积合理（1KB ~ 40KB）', img.buf.length > 1024 && img.buf.length < 40960, img.buf.length);
  ok('响应头禁止缓存', String(img.headers['cache-control']).indexOf('no-store') >= 0, img.headers['cache-control']);

  /* 关键安全断言：图片字节里不能出现明文答案 */
  const ascii = img.buf.toString('latin1');
  const asUtf8 = img.buf.toString('utf8');
  ok('PNG 字节流中不含明文答案', ascii.indexOf(c1.answer) < 0 && asUtf8.indexOf(c1.answer) < 0, c1.answer);

  /* =============== 3. 图形验证码校验（负向） =============== */
  section('3. 图形验证码校验');
  const c2 = await newCaptcha();
  const wrongCap = await req('POST', '/api/code/send', {
    captchaId: c2.id, captchaText: 'ZZZZ', channel: 'phone', target: PHONE, region: 'cn'
  });
  ok('填错图形码被拒（CAPTCHA_BAD）', wrongCap.status === 400 && wrongCap.json.error === 'CAPTCHA_BAD', wrongCap.json);

  const noCap = await req('POST', '/api/code/send', {
    captchaId: 'deadbeef' + '0'.repeat(24), captchaText: 'ABCD', channel: 'phone', target: PHONE, region: 'cn'
  });
  ok('伪造/过期的图形码 ID 被拒（CAPTCHA_EXPIRED）', noCap.status === 400 && noCap.json.error === 'CAPTCHA_EXPIRED', noCap.json);

  ok('图形码最长 4 位（服务端按 4 位设计）', captcha.LENGTH === 4, captcha.LENGTH);

  /* =============== 4. 验证码下发（正向 + 限流） =============== */
  section('4. 验证码下发');
  const c3 = await newCaptcha();
  const send1 = await req('POST', '/api/code/send', {
    captchaId: c3.id, captchaText: c3.answer, channel: 'phone', target: PHONE, region: 'cn'
  });
  ok('图形码正确时下发成功', send1.status === 200 && send1.json.ok === true, send1.json);
  ok('返回 requestId', !!(send1.json && send1.json.requestId), send1.json);
  ok('演示通道回传 devCode', !!(send1.json && send1.json.devCode && /^\d{6}$/.test(send1.json.devCode)), send1.json && send1.json.devCode);
  ok('手机号做了脱敏', send1.json && send1.json.masked === '138****8000', send1.json && send1.json.masked);
  ok('返回冷却秒数 60', send1.json && send1.json.cooldown === 60, send1.json && send1.json.cooldown);

  /* 图形码一次性 */
  const c3reuse = await req('POST', '/api/code/send', {
    captchaId: c3.id, captchaText: c3.answer, channel: 'phone', target: PHONE, region: 'cn'
  });
  ok('图形码用过即焚（不可复用）', c3reuse.status === 400, c3reuse.json);

  /* 60 秒冷却 */
  const c4 = await newCaptcha();
  const tooFast = await req('POST', '/api/code/send', {
    captchaId: c4.id, captchaText: c4.answer, channel: 'phone', target: PHONE, region: 'cn'
  });
  ok('同一手机号 60s 内重发被限流（TOO_FAST）', tooFast.status === 429 && tooFast.json.error === 'TOO_FAST', tooFast.json);
  ok('限流返回剩余秒数', tooFast.json && tooFast.json.retryAfter > 0, tooFast.json && tooFast.json.retryAfter);

  /* 非法目标 */
  const c5 = await newCaptcha();
  const badTarget = await req('POST', '/api/code/send', {
    captchaId: c5.id, captchaText: c5.answer, channel: 'phone', target: '12345', region: 'cn'
  });
  ok('非法手机号被拒（TARGET_BAD）', badTarget.status === 400 && badTarget.json.error === 'TARGET_BAD', badTarget.json);

  /* 邮箱通道 */
  const c6 = await newCaptcha();
  const mailSend = await req('POST', '/api/code/send', {
    captchaId: c6.id, captchaText: c6.answer, channel: 'email', target: EMAIL, region: 'intl'
  });
  ok('邮箱通道同样可用', mailSend.status === 200, mailSend.json);
  ok('邮箱做了脱敏', mailSend.json && /^d\*\*\*/.test(String(mailSend.json.masked)), mailSend.json && mailSend.json.masked);

  /* 跨站 Origin */
  const c7 = await newCaptcha();
  const crossSite = await req('POST', '/api/code/send', {
    captchaId: c7.id, captchaText: c7.answer, channel: 'phone', target: '13900139000', region: 'cn'
  }, { Origin: 'https://evil.example.com' });
  ok('跨站 Origin 被拒（BAD_ORIGIN）', crossSite.status === 403 && crossSite.json.error === 'BAD_ORIGIN', crossSite.json);

  /* =============== 5. 登录校验（负向） =============== */
  section('5. 登录校验');
  const loginNeedsAgree = await req('POST', '/api/login', {
    requestId: send1.json.requestId, code: send1.json.devCode, target: PHONE, channel: 'phone', region: 'cn', agree: false
  });
  ok('未勾选协议被拒（NEED_AGREE）', loginNeedsAgree.status === 400 && loginNeedsAgree.json.error === 'NEED_AGREE', loginNeedsAgree.json);

  const loginBadCode = await req('POST', '/api/login', {
    requestId: send1.json.requestId, code: '000000', target: PHONE, channel: 'phone', region: 'cn', agree: true
  });
  ok('验证码错误被拒（CODE_BAD）', loginBadCode.status === 400 && loginBadCode.json.error === 'CODE_BAD', loginBadCode.json);
  ok('错误后返回剩余尝试次数', loginBadCode.json && loginBadCode.json.triesLeft === 4, loginBadCode.json);

  const loginSwapped = await req('POST', '/api/login', {
    requestId: send1.json.requestId, code: send1.json.devCode, target: '13900139000', channel: 'phone', region: 'cn', agree: true
  });
  ok('中途换手机号被拒（TARGET_CHANGED）', loginSwapped.status === 400 && loginSwapped.json.error === 'TARGET_CHANGED', loginSwapped.json);

  const loginNoReq = await req('POST', '/api/login', {
    requestId: 'f'.repeat(32), code: '123456', target: PHONE, channel: 'phone', region: 'cn', agree: true
  });
  ok('伪造 requestId 被拒（CODE_EXPIRED）', loginNoReq.status === 400 && loginNoReq.json.error === 'CODE_EXPIRED', loginNoReq.json);

  /* =============== 6. 工具页公开可访问 =============== */
  /* 门禁已按需求撤回：不登录也能打开工具页、也能正常使用。
     登录只影响顶栏是否显示账号与退出按钮，不构成任何门槛。 */
  section('6. 工具页公开可访问（无门禁）');
  const gate1 = await req('GET', '/app.html');
  ok('未登录访问 /app.html 返回 200', gate1.status === 200, gate1.status);
  ok('未登录也能拿到工具页 HTML', gate1.text.indexOf('在线语音转写') > 0, gate1.text.slice(0, 60));
  ok('未登录时不产生任何重定向', !gate1.headers.location, gate1.headers.location);

  const gate1b = await req('GET', '/app');
  ok('/app 短链无鉴权地跳到工具页',
    gate1b.status === 302 && String(gate1b.headers.location) === '/app.html', gate1b.headers.location);

  /* =============== 7. 登录成功 =============== */
  section('7. 登录成功与会话');
  const login = await req('POST', '/api/login', {
    requestId: send1.json.requestId, code: send1.json.devCode, target: PHONE, channel: 'phone', region: 'cn', agree: true
  });
  ok('验证码正确时登录成功', login.status === 200 && login.json.ok === true, login.json);
  ok('登录返回目标账号', login.json && login.json.target === PHONE, login.json && login.json.target);

  const cookie = cookieOf(login);
  ok('下发了 lingora_sid 会话 Cookie', !!cookie, cookie);

  const rawCookie = String(login.headers['set-cookie']);
  ok('Cookie 标记 HttpOnly', rawCookie.indexOf('HttpOnly') >= 0, rawCookie);
  ok('Cookie 标记 SameSite=Lax', rawCookie.indexOf('SameSite=Lax') >= 0, rawCookie);
  ok('Cookie 路径为 /', rawCookie.indexOf('Path=/') >= 0, rawCookie);

  const sess1 = await req('GET', '/api/session', null, { Cookie: cookie });
  ok('带 Cookie 查询会话为已登录', sess1.json && sess1.json.authed === true, sess1.json);
  ok('会话里能读到账号', sess1.json && sess1.json.target === PHONE, sess1.json);

  const gate2 = await req('GET', '/app.html', null, { Cookie: cookie });
  ok('已登录访问 /app.html 返回 200', gate2.status === 200, gate2.status);
  ok('已登录能拿到工具页 HTML', gate2.text.indexOf('在线语音转写') > 0, gate2.text.slice(0, 40));

  /* 验证码不可重放 */
  const replay = await req('POST', '/api/login', {
    requestId: send1.json.requestId, code: send1.json.devCode, target: PHONE, channel: 'phone', region: 'cn', agree: true
  });
  ok('同一验证码不可重放（CODE_EXPIRED）', replay.status === 400 && replay.json.error === 'CODE_EXPIRED', replay.json);

  /* 伪造会话 */
  const fake = await req('GET', '/api/session', null, { Cookie: 'lingora_sid=' + 'a'.repeat(64) });
  ok('伪造的会话 token 无效', fake.json && fake.json.authed === false, fake.json);
  const fakeGate = await req('GET', '/app.html', null, { Cookie: 'lingora_sid=' + 'a'.repeat(64) });
  ok('伪造 token 不影响工具页公开访问', fakeGate.status === 200, fakeGate.status);

  /* =============== 8. 邮箱登录（国际区） =============== */
  section('8. 邮箱登录（国际区）');
  const c8 = await newCaptcha();
  const mailSend2 = await req('POST', '/api/code/send', {
    captchaId: c8.id, captchaText: c8.answer, channel: 'email', target: 'intl@lingora.test', region: 'intl'
  });
  ok('国际区邮箱下发成功', mailSend2.status === 200, mailSend2.json);
  const mailLogin = await req('POST', '/api/login', {
    requestId: mailSend2.json.requestId, code: mailSend2.json.devCode,
    target: 'intl@lingora.test', channel: 'email', region: 'intl', agree: true
  });
  ok('国际区邮箱登录成功', mailLogin.status === 200, mailLogin.json);
  ok('区域被记入会话（intl）', mailLogin.json && mailLogin.json.region === 'intl', mailLogin.json);
  const intlCookie = cookieOf(mailLogin);
  const intlGate = await req('GET', '/app.html', null, { Cookie: intlCookie });
  ok('国际区会话同样能进工具页', intlGate.status === 200, intlGate.status);

  /* 推荐码 */
  const c9 = await newCaptcha();
  const refSend = await req('POST', '/api/code/send', {
    captchaId: c9.id, captchaText: c9.answer, channel: 'phone', target: '13700137000', region: 'cn'
  });
  const refLogin = await req('POST', '/api/login', {
    requestId: refSend.json.requestId, code: refSend.json.devCode,
    target: '13700137000', channel: 'phone', region: 'cn', agree: true, referral: 'abcd1234'
  });
  ok('推荐码被规范为大写并在会话中保留', refLogin.json && refLogin.json.referral === 'ABCD1234', refLogin.json);

  /* =============== 9. 退出登录 =============== */
  section('9. 退出登录');
  const out = await req('POST', '/api/logout', null, { Cookie: cookie });
  ok('退出接口返回 200', out.status === 200, out.status);
  const outCookie = String(out.headers['set-cookie']);
  ok('退出时清空 Cookie（Max-Age=0）', outCookie.indexOf('Max-Age=0') >= 0, outCookie);

  const sessAfter = await req('GET', '/api/session', null, { Cookie: cookie });
  ok('退出后会话失效', sessAfter.json && sessAfter.json.authed === false, sessAfter.json);

  const gateAfter = await req('GET', '/app.html', null, { Cookie: cookie });
  ok('退出后工具页依旧可访问（公开页面）', gateAfter.status === 200, gateAfter.status);

  /* =============== 10. 静态资源与前端页面 =============== */
  section('10. 静态资源与前端页面');
  for (const p of ['/', '/index.html', '/login.html', '/register.html', '/assets/auth.css', '/assets/auth.js', '/assets/styles.css']) {
    const r = await req('GET', p);
    ok('静态资源可访问 ' + p, r.status === 200, r.status);
  }
  const htmlCache = await req('GET', '/login.html');
  ok('HTML 不缓存（部署后不会看到旧门禁）', String(htmlCache.headers['cache-control']).indexOf('no-cache') >= 0, htmlCache.headers['cache-control']);
  const ico = await req('GET', '/assets/vendor/gsap/gsap.min.js');
  ok('GSAP 运行时仍可访问（动效不退化）', ico.status === 200, ico.status);

  /* =============== 11. 其他方法 =============== */
  section('11. 方法与未知路由');
  const del = await req('DELETE', '/index.html');
  ok('非 GET/HEAD 的静态请求被拒（405）', del.status === 405, del.status);
  const unknownApi = await req('GET', '/api/nope');
  ok('未知 API 返回 404 + 结构化错误', unknownApi.status === 404 && unknownApi.json.error === 'NO_SUCH_API', unknownApi.json);

  /* =============== 汇总 =============== */
  console.log(lines.join('\n'));
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  通过 ' + pass + ' 项 / 失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项');
  console.log('════════════════════════════════════════');

  try { app.close && app.close(); } catch (_) { /* noop */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.log(lines.join('\n'));
  console.error('\n测试脚本异常：', err && err.stack ? err.stack : err);
  process.exit(2);
});
