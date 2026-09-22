/* ==========================================================================
   Lingora · 账户页逻辑（登录 / 注册）
   文件：assets/auth.js
   --------------------------------------------------------------------------
   这一层负责「事」，不负责「动」：
     · 动效（入场、进度条、降级链）复用 assets/motion.js，本文件不介入
     · 功能逻辑（区域选择、语言切换、tab、校验、验证码、登录）都在这里

   数据流（已接入真实后端）
     GET  /api/captcha/new    申请图形验证码 —— 答案只存在服务端内存
     POST /api/code/send      校验图形码 + 限流 + 投递 6 位验证码
     POST /api/login          校验 6 位码 → 服务端下发 HttpOnly 会话 Cookie
     GET  /api/session        查询当前登录态
     POST /api/logout         退出登录

   会话一律以服务端为准：前端不再自己往 localStorage 写「已登录」。
   若 /api/health 不可达（比如把本站当静态镜像用 file:// 或纯静态托管打开），
   自动降级为「离线预览模式」，并在界面上明确标注。
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ==================================================================
     1. 文案表
     区域（cn / intl）× 语言（zh / en）各自独立，
     切换区域会带上该区域的默认语言，与参考站行为一致
     ================================================================== */
  const COPY = {
    zh: {
      htmlLang: 'zh-CN',
      region: {
        title: '选择服务器区域',
        desc: '由于法律与合规要求，你需要选择服务地区。你的用户数据会被存储于不同地区，账户与充值记录不互通。',
        cnName: '中国区',
        cnNote: '主要在中国大陆使用时选择',
        intlName: '国际区',
        intlNote: '不支持在中国大陆使用',
        cancel: '取消',
        confirm: '确认'
      },
      card: {
        langLabel: '中文（简体）',
        toIntl: '切换到国际区',
        toCn: 'Switch to China',
        welcome: '欢迎使用 Lingora！',
        tagCn: '（中国版）',
        tagIntl: '（国际版）'
      },
      tab: { phone: '手机登录', email: '邮箱登录' },
      field: {
        phone: '手机号',
        email: '邮箱',
        captcha: '图形验证码',
        code: '验证码',
        phonePh: '请输入手机号',
        emailPh: '请输入邮箱地址',
        captchaPh: '4 位字符',
        codePh: '6 位数字',
        getCode: '获取验证码',
        resend: '{n} 秒后重发'
      },
      agree: {
        pre: '我已阅读并同意',
        terms: '用户服务协议',
        and: '和',
        privacy: '隐私协议'
      },
      or: 'Or',
      oauth: { google: '使用 Google 登录', apple: '使用 Apple 登录' },
      referral: {
        link: '有推荐码？点击输入',
        linkSet: '推荐码：{code}',
        title: '推荐码',
        desc: '使用有效推荐码注册，可获得额外赠时。',
        ph: '请输入 8 位推荐码',
        cancel: '取消',
        confirm: '确认'
      },
      demo: {
        online: '服务端已连接',
        onlineDemo: '服务端已连接 · 未配置短信 / 邮件，验证码走演示通道',
        offline: '静态镜像 · 未连接后端，流程仅可预览',
        codeSent: '验证码已发送至 {target}',
        demoCode: '演示验证码：{code}（服务端校验，仅未配置通道时出现）',
        codeBad: '验证码不正确',
        needPhone: '请先填写手机号',
        needEmail: '请先填写邮箱',
        needCaptcha: '请先填写图形验证码',
        phoneBad: '手机号格式不对，请输入 11 位中国大陆手机号',
        emailBad: '邮箱格式不对，请检查后重试',
        captchaBad: '图形验证码不正确',
        agree: '请先勾选同意服务协议与隐私政策',
        oauth: '{name} 登录需要客户端 ID 与服务端回调，本站未接入。',
        welcomeBack: '你已登录（{target}），正在进入工作台…',
        referralOk: '推荐码 {code} 已记录',
        referralBad: '推荐码需为 8 位字母或数字',
        terms: '本站未包含协议全文，正式上线前需接入法务文案'
      },

      /* 接口错误码 → 人话 */
      err: {
        CAPTCHA_BAD: '图形验证码不正确，已换一张',
        CAPTCHA_EXPIRED: '图形验证码已过期，已换一张',
        TARGET_BAD: '手机号或邮箱格式不对',
        TOO_FAST: '发送太频繁，请 {n} 秒后再试',
        IP_LIMITED: '当前网络请求过于频繁，请稍后再试',
        DELIVER_FAILED: '验证码发送失败，请稍后重试',
        NO_CHANNEL: '服务端未配置短信或邮件通道',
        CODE_BAD: '验证码不正确',
        CODE_EXPIRED: '验证码已过期，请重新获取',
        CODE_LOCKED: '错误次数过多，请重新获取验证码',
        TARGET_CHANGED: '手机号已变更，请重新获取验证码',
        NEED_AGREE: '请先勾选同意服务协议与隐私政策',
        BAD_ORIGIN: '请求来源校验失败，请刷新页面重试',
        BAD_JSON: '请求格式错误，请刷新页面重试',
        NETWORK: '无法连接服务端，请检查网络后重试',
        SERVER: '服务端暂时不可用，请稍后重试'
      },

      /* 左侧品牌区文案（随语言切换） */
      aside: {
        eyebrow: '账户',
        title: '登录，把每一场会议变成可检索的文字',
        lead: 'Lingora 把实时转写、双语翻译与会议记录放进同一个窗口。登录后即可延续你的会议历史与偏好设置。',
        p1: '<strong>音频只在会话内处理</strong>，结束后不保留原始录音',
        p2: '<strong>中英日韩</strong>边听边出译文，可开双语字幕',
        p3: '随便哪个会议窗口<strong>都能听</strong>，不用切软件',
        note: '登录采用验证码免密方式：图形验证码由服务端生成并校验，会话以下发到浏览器的 HttpOnly Cookie 为准，前端不参与登录判定。'
      },

      /* 登录 / 注册两种模式的差异文案 */
      mode: {
        login: {
          docTitle: '登录 · Lingora 会议助手',
          welcome: '欢迎使用 Lingora！',
          submit: '登录',
          okMsg: '登录成功，正在进入工作台…',
          switchText: '还没有账户？立即注册'
        },
        register: {
          docTitle: '创建账户 · Lingora 会议助手',
          welcome: '创建你的 Lingora 账户',
          submit: '创建账户并登录',
          okMsg: '账户已创建，正在进入工作台…',
          switchText: '已有账户？直接登录',
          aside: {
            eyebrow: '注册',
            title: '创建账户，只花一次验证码的时间',
            lead: 'Lingora 采用验证码免密方式：填一次手机号或邮箱，账户就建好了。下次用同一个号码即可继续登录。',
            p1: '<strong>不用设置密码</strong>，验证码就是你的凭证',
            p2: '填写有效<strong>推荐码</strong>可获得额外赠时',
            p3: '中国区与国际区<strong>账户独立</strong>，数据不互通',
            note: '参考产品把注册并进了登录（首次验证码登录即完成注册），没有单独的注册页；这一页是按本站设计稿（屏 3:5）保留的独立入口，走的接口与登录页完全一致。'
          }
        }
      }
    },
    en: {
      htmlLang: 'en',
      region: {
        title: 'Select server region',
        desc: 'For legal and compliance reasons you must choose a service region. Your data is stored in different regions; accounts and billing are not interchangeable.',
        cnName: 'China',
        cnNote: 'Choose this when mainly using in mainland China',
        intlName: 'Global',
        intlNote: 'Not available in mainland China',
        cancel: 'Cancel',
        confirm: 'Confirm'
      },
      card: {
        langLabel: 'English',
        toIntl: '切换到国际区',
        toCn: 'Switch to China',
        welcome: 'Welcome to Lingora!',
        tagCn: '（China）',
        tagIntl: '(Global)'
      },
      tab: { phone: 'Phone', email: 'Email' },
      field: {
        phone: 'Phone number',
        email: 'Email',
        captcha: 'Verification image',
        code: 'Verification code',
        phonePh: 'Enter phone number',
        emailPh: 'Enter email address',
        captchaPh: '4 characters',
        codePh: '6 digits',
        getCode: 'Get code',
        resend: 'Retry in {n}s'
      },
      agree: {
        pre: 'I have read and agree to the',
        terms: 'Terms of Service',
        and: 'and',
        privacy: 'Privacy Policy'
      },
      or: 'Or',
      oauth: { google: 'Sign in with Google', apple: 'Sign in with Apple' },
      referral: {
        link: 'Have a referral code? Enter it',
        linkSet: 'Referral: {code}',
        title: 'Referral code',
        desc: 'Using a valid referral code at sign-up grants extra minutes.',
        ph: 'Enter 8-character code',
        cancel: 'Cancel',
        confirm: 'Confirm'
      },
      demo: {
        online: 'Backend connected',
        onlineDemo: 'Backend connected · no SMS / email configured, codes use the demo channel',
        offline: 'Static mirror · no backend, flow is preview only',
        codeSent: 'Code sent to {target}',
        demoCode: 'Demo code: {code} (verified server-side; shown only when no channel is configured)',
        codeBad: 'Incorrect code',
        needPhone: 'Enter your phone number first',
        needEmail: 'Enter your email first',
        needCaptcha: 'Enter the image code first',
        phoneBad: 'Invalid phone number',
        emailBad: 'Invalid email address',
        captchaBad: 'Incorrect image code',
        agree: 'Please agree to the terms and privacy policy first',
        oauth: '{name} sign-in needs a client ID and a server callback — not wired up here.',
        welcomeBack: 'Already signed in ({target}) — opening the workspace…',
        referralOk: 'Referral {code} saved',
        referralBad: 'Referral code must be 8 letters or digits',
        terms: 'Terms text is not part of this build — wire in legal copy before launch'
      },
      err: {
        CAPTCHA_BAD: 'Incorrect image code — a new one was loaded',
        CAPTCHA_EXPIRED: 'Image code expired — a new one was loaded',
        TARGET_BAD: 'Invalid phone number or email',
        TOO_FAST: 'Too many requests — retry in {n}s',
        IP_LIMITED: 'Too many requests from this network — try later',
        DELIVER_FAILED: 'Could not send the code — try again later',
        NO_CHANNEL: 'No SMS or email channel configured on the server',
        CODE_BAD: 'Incorrect code',
        CODE_EXPIRED: 'Code expired — request a new one',
        CODE_LOCKED: 'Too many wrong attempts — request a new code',
        TARGET_CHANGED: 'The number changed — request a new code',
        NEED_AGREE: 'Please agree to the terms and privacy policy first',
        BAD_ORIGIN: 'Origin check failed — refresh the page and retry',
        BAD_JSON: 'Malformed request — refresh the page and retry',
        NETWORK: 'Cannot reach the server — check your connection',
        SERVER: 'Server temporarily unavailable — try again later'
      },
      aside: {
        eyebrow: 'Account',
        title: 'Sign in and turn every meeting into searchable text',
        lead: 'Lingora puts live transcription, bilingual translation and meeting notes in one window. Sign in to pick up your history and preferences.',
        p1: '<strong>Audio is processed in-session only</strong> — raw recordings are not kept',
        p2: '<strong>Chinese, English, Japanese, Korean</strong> translated as you listen, with dual subtitles',
        p3: 'Works alongside <strong>any meeting window</strong> — no app switching',
        note: 'Sign-in is passwordless: the image code is generated and verified on the server, and the session lives in an HttpOnly cookie. The front end never decides whether you are signed in.'
      },
      mode: {
        login: {
          docTitle: 'Sign in · Lingora Meeting Assistant',
          welcome: 'Welcome to Lingora!',
          submit: 'Login',
          okMsg: 'Signed in. Opening the workspace…',
          switchText: "Don't have an account? Sign up"
        },
        register: {
          docTitle: 'Create account · Lingora Meeting Assistant',
          welcome: 'Create your Lingora account',
          submit: 'Create account & sign in',
          okMsg: 'Account created. Opening the workspace…',
          switchText: 'Already have an account? Sign in',
          aside: {
            eyebrow: 'Sign up',
            title: 'Create your account — it costs one code',
            lead: 'Lingora is passwordless: enter a phone number or email once and the account exists. Use the same identifier next time to sign in.',
            p1: '<strong>No password to set</strong> — the one-time code is your credential',
            p2: 'Enter a valid <strong>referral code</strong> to get extra minutes',
            p3: 'China and Global <strong>accounts are separate</strong>; data is not interchangeable',
            note: 'The reference product folds sign-up into sign-in (your first code login creates the account) and has no dedicated page. This page keeps the standalone entry from our design file (screen 3:5) and calls exactly the same endpoints.'
          }
        }
      }
    }
  };

  const STORE = {
    region: 'lingora.auth.region',
    lang: 'lingora.auth.lang',
    referral: 'lingora.auth.referral'
  };

  /* 页面模式，由 <body data-mode="..."> 决定
     · login    —— 对应参考站的「验证码免密登录」（参考站没有独立注册页，登录即注册）
     · register —— 本站设计稿（屏 3:5）保留的独立注册页，作为登录页的补充形态 */
  const MODE = document.body && document.body.dataset.mode === 'register' ? 'register' : 'login';

  const read = (k, fb) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fb : v;
    } catch (_) { return fb; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, v); } catch (_) { /* 隐私模式下静默失败 */ }
  };

  /* 登录成功后的落点。只接受站内相对路径，挡掉开放重定向 */
  const NEXT = (() => {
    const raw = new URLSearchParams(window.location.search).get('next') || '';
    if (!raw) return 'app.html';
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return 'app.html';
    if (raw.indexOf('//') === 0) return 'app.html';
    return raw.replace(/^\/+/, '') || 'app.html';
  })();

  /* ==================================================================
     2. 状态
     ================================================================== */
  const state = {
    region: read(STORE.region, '') || 'cn',
    lang: read(STORE.lang, '') || 'zh',
    tab: 'phone',
    referral: read(STORE.referral, '') || '',

    /* 后端契约 */
    backend: 'unknown',      /* unknown | online | offline */
    session: null,
    captchaId: '',
    requestId: '',
    requestTarget: '',
    localCode: '',           /* 离线预览模式下的前端演示码 */

    sending: false,
    submitting: false
  };

  const copy = () => COPY[state.lang];
  const m = () => copy().mode[MODE];
  const online = () => state.backend === 'online';

  /* ==================================================================
     3. 小工具
     ================================================================== */
  const gsapRef = () => (window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? window.gsap : null);

  /* 有 GSAP 用 GSAP，没有就直接显示 —— 动效永远是增强 */
  function popIn(el, opts) {
    const g = gsapRef();
    const o = opts || {};
    if (!g) return;
    g.fromTo(
      el,
      { autoAlpha: 0, y: o.y == null ? 10 : o.y, scale: o.scale == null ? 0.98 : o.scale },
      { autoAlpha: 1, y: 0, scale: 1, duration: o.duration || 0.34, ease: 'power3.out', clearProps: 'scale' }
    );
  }

  function fmt(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (mk, k) => (vars && k in vars ? vars[k] : mk));
  }

  function onlyDigits(s) {
    return String(s || '').replace(/\D+/g, '');
  }

  /* 中国大陆手机号：3-4-4 分组，纯展示用（提交时再取纯数字） */
  function groupPhone(digits) {
    const d = digits.slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0, 3) + ' ' + d.slice(3);
    return d.slice(0, 3) + ' ' + d.slice(3, 7) + ' ' + d.slice(7);
  }

  /* ------------------------------------------------------------------
     输入框「格式化 + 光标保持」

     跳字的根因：给输入值插入分隔符后，字符下标整体右移，
     若把格式化**前**的下标直接塞进格式化**后**的字符串，
     光标就会停到上一个字符上，表现为「打一个数字，光标往后退」。

     解法：不搬下标，而是数「光标前面有几个有效字符」，
     格式化后找到第同样多个有效字符的位置，把光标放到它后面。
     插入多少个分隔符都不影响这个映射。
     ------------------------------------------------------------------ */
  const isDigitChar = (ch) => ch >= '0' && ch <= '9';
  const isCodeChar = (ch) => (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');

  /* caret 之前有几个满足 test 的字符 */
  function countBefore(str, caret, test) {
    const end = caret == null ? str.length : Math.max(0, Math.min(caret, str.length));
    let n = 0;
    for (let i = 0; i < end; i += 1) if (test(str.charAt(i))) n += 1;
    return n;
  }

  /* 「第 n 个有效字符之后」的下标；n=0 时返回第一个有效字符之前 */
  function caretAfter(str, n, test) {
    if (n <= 0) {
      for (let i = 0; i < str.length; i += 1) if (test(str.charAt(i))) return i;
      return 0;
    }
    let seen = 0;
    for (let i = 0; i < str.length; i += 1) {
      if (!test(str.charAt(i))) continue;
      seen += 1;
      if (seen === n) return i + 1;
    }
    return str.length;
  }

  function setCaret(node, pos) {
    try { node.setSelectionRange(pos, pos); } catch (_) { /* 某些类型不支持，忽略 */ }
  }

  function reformatKeepingCaret(node, formatter, test) {
    const before = node.value;
    const caret = countBefore(before, node.selectionStart, test);
    const after = formatter(before);
    if (after === before) return false;
    node.value = after;
    setCaret(node, caretAfter(after, caret, test));
    return true;
  }

  /* 退格正好落在分隔符上时，应当连它前面那个有效字符一起删掉。
     否则格式化会把空格补回来，用户感觉「按了没反应」。 */
  function deleteCharBeforeCaret(node, formatter, test) {
    const before = node.value;
    const n = countBefore(before, node.selectionStart, test);
    if (n === 0) return false;

    const chars = [];
    for (let i = 0; i < before.length; i += 1) {
      if (test(before.charAt(i))) chars.push(before.charAt(i));
    }
    chars.splice(n - 1, 1);

    const after = formatter(chars.join(''));
    node.value = after;
    setCaret(node, caretAfter(after, n - 1, test));
    return true;
  }

  /* 统一接线：input 格式化 / 退格跨分隔符 / 中文输入法组合态 */
  function wireFormattedInput(node, opts) {
    if (!node) return;
    const formatter = opts.format;
    const test = opts.test;
    const after = opts.after || function () { };
    let composing = false;

    node.addEventListener('compositionstart', () => { composing = true; });
    node.addEventListener('compositionend', () => {
      composing = false;
      reformatKeepingCaret(node, formatter, test);
      after();
    });

    node.addEventListener('beforeinput', (e) => {
      if (composing) return;
      if (e.inputType !== 'deleteContentBackward') return;
      const i = node.selectionStart;
      if (i == null || i !== node.selectionEnd || i === 0) return;
      const left = node.value.charAt(i - 1);
      if (test(left)) return;               /* 左边是要保留的字符，交给浏览器 */
      if (!/\s/.test(left)) return;          /* 只接管分隔空格 */
      e.preventDefault();
      deleteCharBeforeCaret(node, formatter, test);
      after();
    });

    node.addEventListener('input', () => {
      if (composing) return;
      reformatKeepingCaret(node, formatter, test);
      after();
    });
  }

  const fmtPhone = (v) => groupPhone(onlyDigits(v));
  const fmtCode = (v) => onlyDigits(v).slice(0, 6);
  const fmtCaptcha = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Za-z]/g, '').slice(0, 4);
  const fmtReferral = (v) => String(v || '').toUpperCase().replace(/[^A-Za-z0-9]/g, '').slice(0, 8);

  /* ==================================================================
     4. 接口层
     ================================================================== */
  const API = (function () {
    function withTimeout(promise, ms) {
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(
          (v) => { window.clearTimeout(timer); resolve(v); },
          (e) => { window.clearTimeout(timer); reject(e); }
        );
      });
    }

    function call(path, opts) {
      const init = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
      if (init.body && typeof init.body !== 'string') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(init.body);
      }
      return window.fetch(path, init).then((res) => res.json().catch(() => null).then((data) => ({
        status: res.status,
        ok: res.ok,
        data: data
      })));
    }

    return {
      health: () => call('/api/health'),
      session: () => call('/api/session'),
      newCaptcha: () => call('/api/captcha/new'),
      sendCode: (payload) => call('/api/code/send', { method: 'POST', body: payload }),
      login: (payload) => call('/api/login', { method: 'POST', body: payload }),
      logout: () => call('/api/logout', { method: 'POST' }),
      withTimeout: withTimeout
    };
  })();

  /* 接口错误码 → 当前语言的人话 */
  function errText(code, vars) {
    const table = copy().err;
    const msg = table[code] || table.SERVER;
    return fmt(msg, vars || {});
  }

  function reportApiError(r) {
    const status = r && r.status;
    const code = r && r.data && r.data.error;

    if (!r) { toast(errText('NETWORK'), 'warn', 5200); return 'NETWORK'; }
    if (code) {
      const vars = { n: (r.data && r.data.retryAfter) || 60 };
      toast(errText(code, vars), 'warn', code === 'TOO_FAST' ? 5200 : 4200);
      return code;
    }
    if (status >= 500) { toast(errText('SERVER'), 'warn', 5200); return 'SERVER'; }
    toast(errText('SERVER'), 'warn', 5200);
    return 'SERVER';
  }

  /* ==================================================================
     5. DOM 引用
     ================================================================== */
  const el = {
    regionModal: $('#regionModal'),
    regionDesc: $('#regionDesc'),
    regionTitle: $('#regionTitle'),
    regionOptions: $$('.regionopt'),
    regionCancel: $('#regionCancel'),
    regionConfirm: $('#regionConfirm'),

    langLabel: $('#langLabel'),
    regionSwitch: $('#regionSwitch'),
    welcome: $('#welcome'),
    welcomeText: $('#welcomeText'),
    welcomeTag: $('#welcomeTag'),

    /* 左侧品牌区（随语言切换） */
    asideEyebrow: $('#asideEyebrow'),
    asideTitle: $('#asideTitle'),
    asideLead: $('#asideLead'),
    asideP1: $('#asideP1'),
    asideP2: $('#asideP2'),
    asideP3: $('#asideP3'),
    asideNote: $('#asideNote'),

    seg: $('.seg'),
    segButtons: $$('.seg button'),

    phoneField: $('#phoneField'),
    phoneInput: $('#phoneInput'),
    phoneLabel: $('#phoneLabel'),
    phoneErr: $('#phoneErr'),
    ccButton: $('#ccButton'),

    emailField: $('#emailField'),
    emailInput: $('#emailInput'),
    emailLabel: $('#emailLabel'),
    emailErr: $('#emailErr'),

    captchaField: $('#captchaField'),
    captchaLabel: $('#captchaLabel'),
    captchaInput: $('#captchaInput'),
    captchaErr: $('#captchaErr'),
    captchaBox: $('#captchaBox'),
    captchaImg: $('#captchaImg'),
    captchaImgBtn: $('#captchaImgBtn'),
    captchaRefresh: $('#captchaRefresh'),

    codeField: $('#codeField'),
    codeInput: $('#codeInput'),
    codeLabel: $('#codeLabel'),
    codeBtn: $('#codeBtn'),
    codeErr: $('#codeErr'),

    agreeCheck: $('#agreeCheck'),
    agreeText: $('#agreeText'),
    submit: $('#authSubmit'),
    submitLabel: $('#submitLabel'),

    orText: $('#orText'),
    oauthGoogle: $('#oauthGoogle'),
    oauthApple: $('#oauthApple'),

    referralLink: $('#referralLink'),
    switchMode: $('#switchMode'),
    referralModal: $('#referralModal'),
    referralInput: $('#referralInput'),
    referralErr: $('#referralErr'),
    referralCancel: $('#referralCancel'),
    referralConfirm: $('#referralConfirm'),

    toasts: $('#toasts'),
    demoFlag: $('#demoFlag'),
    footTerms: $('#footTerms'),
    footPrivacy: $('#footPrivacy'),
    footBack: $('#footBack')
  };

  /* 构造 SVG 兜底图（后端不可达时不让 <img> 显示破图） */
  const CAPTCHA_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="168" height="56" viewBox="0 0 168 56">'
    + '<rect width="168" height="56" rx="10" fill="#F1EEE6"/>'
    + '<text x="84" y="33" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#9AA7BB">未连接服务端</text>'
    + '</svg>'
  );

  /* ==================================================================
     6. 渲染：把文案刷到界面上
     ================================================================== */
  const usesPhone = () => state.region === 'cn' && state.tab === 'phone';

  function visibleFields() {
    const list = usesPhone() ? ['phone'] : ['email'];
    if (!online()) return list.concat(['code']);   /* 离线预览没有图形码环节 */
    return list.concat(['captcha', 'code']);
  }

  function render() {
    const c = copy();
    const md = m();
    document.documentElement.lang = c.htmlLang;
    document.title = md.docTitle;

    /* 左侧品牌区：模式自带文案优先（注册页与登录页说得不一样），否则用语言默认 */
    const a = md.aside || c.aside;
    if (el.asideEyebrow) el.asideEyebrow.textContent = a.eyebrow;
    if (el.asideTitle) el.asideTitle.textContent = a.title;
    if (el.asideLead) el.asideLead.textContent = a.lead;
    if (el.asideP1) el.asideP1.innerHTML = a.p1;
    if (el.asideP2) el.asideP2.innerHTML = a.p2;
    if (el.asideP3) el.asideP3.innerHTML = a.p3;
    if (el.asideNote) el.asideNote.textContent = a.note;
    if (el.switchMode) el.switchMode.textContent = md.switchText;

    /* 区域弹窗 */
    if (el.regionTitle) el.regionTitle.textContent = c.region.title;
    if (el.regionDesc) el.regionDesc.textContent = c.region.desc;
    $$('[data-region-name]').forEach((node) => {
      const key = node.dataset.regionName;
      node.textContent = key === 'cn' ? c.region.cnName : c.region.intlName;
    });
    $$('[data-region-note]').forEach((node) => {
      const key = node.dataset.regionNote;
      node.textContent = key === 'cn' ? c.region.cnNote : c.region.intlNote;
    });
    if (el.regionCancel) el.regionCancel.textContent = c.region.cancel;
    if (el.regionConfirm) el.regionConfirm.textContent = c.region.confirm;

    /* 卡片头 */
    if (el.langLabel) el.langLabel.textContent = c.card.langLabel;
    if (el.regionSwitch) {
      el.regionSwitch.textContent = state.region === 'cn' ? c.card.toIntl : c.card.toCn;
    }
    /* 标题里 #welcomeTag 是独立 span，得先取出来再插回去；
       直接 el.welcome.textContent = ... 会把标签节点一起吞掉 */
    if (el.welcome) {
      const tag = el.welcomeTag;
      el.welcome.textContent = md.welcome;
      if (tag) el.welcome.appendChild(tag);
    }
    if (el.welcomeTag) {
      el.welcomeTag.textContent = state.region === 'cn' ? c.card.tagCn : c.card.tagIntl;
    }

    /* tab：国际区没有手机登录（与参考站一致）
       tab 归一化必须放在刷 aria-selected 之前，
       否则切到国际区时会留下「选中态挂在已隐藏的手机按钮上」 */
    if (state.region !== 'cn' && state.tab === 'phone') state.tab = 'email';
    el.segButtons.forEach((b) => {
      const key = b.dataset.tab;
      b.querySelector('[data-slot]').textContent = key === 'phone' ? c.tab.phone : c.tab.email;
      const isPhone = key === 'phone';
      b.hidden = isPhone && state.region !== 'cn';
      b.setAttribute('aria-selected', String(state.tab === key));
    });
    /* 国际区只剩邮箱一种方式，分段控件没有意义 —— 整块收起（参考站国际版也没有 tab 行） */
    if (el.seg) el.seg.hidden = state.region !== 'cn';

    /* 字段标签与占位 */
    if (el.phoneLabel) el.phoneLabel.textContent = c.field.phone;
    if (el.phoneInput) el.phoneInput.placeholder = c.field.phonePh;
    if (el.emailLabel) el.emailLabel.textContent = c.field.email;
    if (el.emailInput) el.emailInput.placeholder = c.field.emailPh;
    if (el.captchaLabel) el.captchaLabel.textContent = c.field.captcha;
    if (el.captchaInput) el.captchaInput.placeholder = c.field.captchaPh;
    if (el.codeLabel) el.codeLabel.textContent = c.field.code;
    if (el.codeInput) el.codeInput.placeholder = c.field.codePh;
    if (el.codeBtn && !el.codeBtn.dataset.cooling) el.codeBtn.textContent = c.field.getCode;

    /* 可见字段 */
    const vis = visibleFields();
    if (el.phoneField) el.phoneField.hidden = !vis.includes('phone');
    if (el.emailField) el.emailField.hidden = !vis.includes('email');
    if (el.captchaField) el.captchaField.hidden = !vis.includes('captcha');
    if (el.codeField) el.codeField.hidden = !vis.includes('code');

    /* 协议 */
    if (el.agreeText) {
      el.agreeText.innerHTML =
        c.agree.pre + ' <a href="#terms">' + c.agree.terms + '</a> ' +
        c.agree.and + ' <a href="#privacy">' + c.agree.privacy + '</a>。';
    }

    if (el.submitLabel) el.submitLabel.textContent = md.submit;
    if (el.orText) el.orText.textContent = c.or;

    /* 第三方：中国区只有 Apple，国际区 Google + Apple（照参考站） */
    if (el.oauthGoogle) {
      el.oauthGoogle.hidden = state.region !== 'intl';
      el.oauthGoogle.querySelector('[data-slot]').textContent = c.oauth.google;
    }
    if (el.oauthApple) el.oauthApple.querySelector('[data-slot]').textContent = c.oauth.apple;

    /* 推荐码 */
    if (el.referralLink) {
      const isSet = !!state.referral;
      el.referralLink.textContent = isSet
        ? fmt(c.referral.linkSet, { code: state.referral })
        : c.referral.link;
      el.referralLink.classList.toggle('is-set', isSet);
    }
    const rm = $('#referralTitle');
    if (rm) rm.textContent = c.referral.title;
    const rd = $('#referralDesc');
    if (rd) rd.textContent = c.referral.desc;
    if (el.referralInput) el.referralInput.placeholder = c.referral.ph;
    if (el.referralCancel) el.referralCancel.textContent = c.referral.cancel;
    if (el.referralConfirm) el.referralConfirm.textContent = c.referral.confirm;

    /* 后端状态徽标：说清楚当前是真连了后端，还是在静态镜像上预览 */
    if (el.demoFlag) {
      const slot = el.demoFlag.querySelector('[data-slot]');
      const text = !online() ? c.demo.offline : (state.session ? c.demo.online : c.demo.onlineDemo);
      if (slot) slot.textContent = text;
      el.demoFlag.classList.toggle('is-offline', !online());
    }

    /* 区域选项选中态 */
    el.regionOptions.forEach((o) => {
      o.setAttribute('aria-pressed', String(o.dataset.region === state.region));
    });

    /* 页脚 */
    if (el.footTerms) el.footTerms.textContent = c.agree.terms;
    if (el.footPrivacy) el.footPrivacy.textContent = c.agree.privacy;
    if (el.footBack) el.footBack.textContent = state.lang === 'zh' ? '返回首页' : 'Back to home';
  }

  /* ==================================================================
     7. Toast
     ================================================================== */
  const ICON_OK = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M6 10.4l2.6 2.6L14 7.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_WARN = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M10 5.6v5.2M10 14.2v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function toast(msg, kind, ms) {
    if (!el.toasts) return;
    const node = document.createElement('div');
    node.className = 'toast toast--' + (kind || 'ok');
    node.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
    node.innerHTML = (kind === 'warn' ? ICON_WARN : ICON_OK) + '<span></span>';
    node.querySelector('span').textContent = msg;
    el.toasts.appendChild(node);
    popIn(node, { y: 14, scale: 1, duration: 0.3 });

    const kill = () => {
      const g = gsapRef();
      if (g) {
        g.to(node, {
          autoAlpha: 0, y: 8, duration: 0.26, ease: 'power2.in',
          onComplete: () => node.remove()
        });
      } else {
        node.remove();
      }
    };
    window.setTimeout(kill, ms || 4200);
  }

  /* ==================================================================
     8. 弹窗开关（含焦点管理与 Esc）
     ================================================================== */
  let lastFocus = null;

  function openModal(node) {
    if (!node) return;
    lastFocus = document.activeElement;
    node.hidden = false;
    const panel = $('.modal__panel', node);
    popIn(panel, { y: 16, scale: 0.97, duration: 0.34 });
    const focusable = panel.querySelector('input, button:not([hidden])');
    if (focusable) window.setTimeout(() => focusable.focus(), 60);
  }

  function closeModal(node) {
    if (!node || node.hidden) return;
    node.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (el.referralModal && !el.referralModal.hidden) { closeModal(el.referralModal); return; }
    if (el.regionModal && !el.regionModal.hidden && state.region) closeModal(el.regionModal);
  });

  $$('.modal').forEach((node) => {
    const mask = $('.modal__mask', node);
    if (mask) mask.addEventListener('click', () => {
      /* 区域选择是必经步骤，不允许点遮罩跳过 */
      if (node === el.regionModal) return;
      closeModal(node);
    });
  });

  /* ==================================================================
     9. 区域选择
     ================================================================== */
  function chooseRegion(region) {
    state.region = region;
    /* 与参考站一致：区域决定了默认界面语言 */
    state.lang = region === 'cn' ? 'zh' : 'en';
    if (region !== 'cn') state.tab = 'email';
    write(STORE.region, region);
    write(STORE.lang, state.lang);
    render();
  }

  function openRegion() {
    if (el.regionCancel) el.regionCancel.hidden = false;
    openModal(el.regionModal);
  }

  el.regionOptions.forEach((o) => {
    o.addEventListener('click', () => {
      el.regionOptions.forEach((x) => x.setAttribute('aria-pressed', String(x === o)));
    });
  });

  if (el.regionConfirm) {
    el.regionConfirm.addEventListener('click', () => {
      const picked = el.regionOptions.find((o) => o.getAttribute('aria-pressed') === 'true');
      chooseRegion((picked && picked.dataset.region) || 'cn');
      closeModal(el.regionModal);
      toast(state.lang === 'zh'
        ? '已选择' + copy().region[state.region === 'cn' ? 'cnName' : 'intlName']
        : 'Region set to ' + copy().region[state.region === 'cn' ? 'cnName' : 'intlName'], 'ok');
    });
  }

  if (el.regionCancel) {
    el.regionCancel.addEventListener('click', () => {
      /* 若已有区域记录，取消即保持原样；否则落到中国区 */
      if (!read(STORE.region, '')) chooseRegion('cn');
      closeModal(el.regionModal);
    });
  }

  if (el.regionSwitch) {
    el.regionSwitch.addEventListener('click', () => openRegion());
  }

  /* 语言也能单独切（比参考站多给一个自由度） */
  if (el.langLabel) {
    el.langLabel.addEventListener('click', () => {
      state.lang = state.lang === 'zh' ? 'en' : 'zh';
      write(STORE.lang, state.lang);
      render();
    });
    el.langLabel.classList.add('authcard__switch');
    el.langLabel.setAttribute('role', 'button');
    el.langLabel.setAttribute('tabindex', '0');
    el.langLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.langLabel.click(); }
    });
  }

  /* ==================================================================
     10. Tab 切换
     ================================================================== */
  const segIndicator = () => {
    const active = el.segButtons.find((b) => b.getAttribute('aria-selected') === 'true');
    if (!active) return;
    popIn(active, { y: 0, scale: 1, duration: 0.28 });
  };

  el.segButtons.forEach((b) => {
    b.addEventListener('click', () => {
      if (b.hidden) return;
      state.tab = b.dataset.tab;
      clearErrors();
      resetFlow();
      render();
      segIndicator();
      const focusTarget = state.tab === 'phone' ? el.phoneInput : el.emailInput;
      if (focusTarget) focusTarget.focus();
    });
  });

  /* ==================================================================
     11. 校验
     ================================================================== */
  const isPhone = (v) => /^1[3-9]\d{9}$/.test(onlyDigits(v));
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

  function setError(field, errNode, msg) {
    if (!field) return;
    field.classList.toggle('is-invalid', !!msg);
    if (errNode) errNode.textContent = msg || '';
  }

  function clearErrors() {
    setError(el.phoneField, el.phoneErr, '');
    setError(el.emailField, el.emailErr, '');
    setError(el.captchaField, el.captchaErr, '');
    setError(el.codeField, el.codeErr, '');
    if (el.agreeCheck) el.agreeCheck.parentElement.classList.remove('is-invalid');
  }

  function targetValue() {
    return usesPhone() ? onlyDigits(el.phoneInput.value) : String(el.emailInput.value || '').trim();
  }

  function validateTarget(quiet) {
    const c = copy();
    if (usesPhone()) {
      if (!targetValue()) {
        if (!quiet) setError(el.phoneField, el.phoneErr, c.demo.needPhone);
        return false;
      }
      if (!isPhone(targetValue())) {
        setError(el.phoneField, el.phoneErr, c.demo.phoneBad);
        return false;
      }
    } else {
      if (!targetValue()) {
        if (!quiet) setError(el.emailField, el.emailErr, c.demo.needEmail);
        return false;
      }
      if (!isEmail(targetValue())) {
        setError(el.emailField, el.emailErr, c.demo.emailBad);
        return false;
      }
    }
    return true;
  }

  /* 目标变了（手机号/邮箱/区域/tab 改了）就作废上一次的验证码请求 */
  function currentTargetKey() {
    return (usesPhone() ? 'phone:' : 'email:') + targetValue();
  }

  function resetFlow() {
    /* 只有「已经发过验证码」才需要换一张图形码。
       否则用户每敲一个数字都会触发一次 /api/captcha/new，
       白白打请求还把已经在看的图形码换掉。 */
    const hadRequest = !!(state.requestId || state.localCode || state.requestTarget);
    state.requestId = '';
    state.requestTarget = '';
    state.localCode = '';
    setError(el.codeField, el.codeErr, '');
    if (el.codeInput) el.codeInput.value = '';
    if (online() && hadRequest) refreshCaptcha();
  }

  /* ==================================================================
     12. 输入接线（全部走「格式化 + 光标保持」）
     ================================================================== */
  wireFormattedInput(el.phoneInput, {
    format: fmtPhone,
    test: isDigitChar,
    after: () => {
      if (el.phoneField && el.phoneField.classList.contains('is-invalid')) validateTarget();
      if (currentTargetKey() !== state.requestTarget) resetFlow();
    }
  });

  wireFormattedInput(el.captchaInput, {
    format: fmtCaptcha,
    test: isCodeChar,
    after: () => {
      if (el.captchaErr && el.captchaErr.textContent) setError(el.captchaField, el.captchaErr, '');
    }
  });

  wireFormattedInput(el.codeInput, {
    format: fmtCode,
    test: isDigitChar,
    after: () => setError(el.codeField, el.codeErr, '')
  });

  wireFormattedInput(el.referralInput, {
    format: fmtReferral,
    test: isCodeChar,
    after: () => {
      if (el.referralErr) el.referralErr.textContent = '';
      const box = el.referralModal && el.referralModal.querySelector('.codefield');
      if (box) box.classList.remove('is-invalid');
    }
  });

  if (el.emailInput) {
    el.emailInput.addEventListener('blur', () => {
      if (el.emailInput.value && !isEmail(el.emailInput.value)) validateTarget();
      else setError(el.emailField, el.emailErr, '');
    });
    el.emailInput.addEventListener('input', () => {
      if (currentTargetKey() !== state.requestTarget) resetFlow();
    });
  }

  /* ==================================================================
     13. 图形验证码
     ================================================================== */
  function setCaptchaImage(src) {
    if (!el.captchaImg) return;
    el.captchaImg.src = src;
  }

  async function refreshCaptcha() {
    if (!online() || !el.captchaImg) return;
    state.captchaId = '';
    if (el.captchaBox) el.captchaBox.classList.add('is-loading');
    try {
      const r = await API.newCaptcha();
      if (r.ok && r.data && r.data.captchaId) {
        state.captchaId = r.data.captchaId;
        /* 加时间戳绕过缓存：同一张图片 URL 不该被复用 */
        setCaptchaImage(r.data.imageUrl + '?t=' + Date.now());
      } else {
        setCaptchaImage(CAPTCHA_PLACEHOLDER);
      }
    } catch (_) {
      setCaptchaImage(CAPTCHA_PLACEHOLDER);
    } finally {
      if (el.captchaBox) el.captchaBox.classList.remove('is-loading');
    }
  }

  [[el.captchaImgBtn, null], [el.captchaRefresh, null]].forEach((pair) => {
    const node = pair[0];
    if (!node) return;
    node.addEventListener('click', (e) => {
      e.preventDefault();
      refreshCaptcha();
    });
  });

  if (el.captchaImg) {
    el.captchaImg.addEventListener('error', () => {
      setCaptchaImage(CAPTCHA_PLACEHOLDER);
    });
  }

  /* ==================================================================
     14. 获取验证码
     ================================================================== */
  let coolTimer = null;

  function startCooldown(sec) {
    if (!el.codeBtn) return;
    let left = sec;
    el.codeBtn.dataset.cooling = '1';
    el.codeBtn.disabled = true;
    el.codeBtn.textContent = fmt(copy().field.resend, { n: left });
    window.clearInterval(coolTimer);
    coolTimer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(coolTimer);
        coolTimer = null;
        delete el.codeBtn.dataset.cooling;
        el.codeBtn.disabled = false;
        el.codeBtn.textContent = copy().field.getCode;
        return;
      }
      el.codeBtn.textContent = fmt(copy().field.resend, { n: left });
    }, 1000);
  }

  /* —— 离线预览：没有后端，只能给一个前端演示码（不参与任何服务端校验） —— */
  function sendCodeOffline() {
    state.localCode = String(Math.floor(100000 + Math.random() * 900000));
    state.requestTarget = currentTargetKey();
    toast(fmt(copy().demo.demoCode, { code: state.localCode }), 'warn', 9000);
    startCooldown(60);
    if (el.codeInput) el.codeInput.focus();
  }

  /* —— 在线：先校验图形码，再由服务端下发 —— */
  async function sendCodeOnline() {
    if (state.sending) return;

    const cap = String(el.captchaInput ? el.captchaInput.value : '').trim();
    if (!cap) {
      setError(el.captchaField, el.captchaErr, copy().demo.needCaptcha);
      if (el.captchaInput) el.captchaInput.focus();
      return;
    }
    if (!state.captchaId) {
      toast(errText('CAPTCHA_EXPIRED'), 'warn');
      refreshCaptcha();
      return;
    }

    state.sending = true;
    if (el.codeBtn) el.codeBtn.disabled = true;

    let r = null;
    try {
      r = await API.withTimeout(API.sendCode({
        captchaId: state.captchaId,
        captchaText: cap,
        channel: usesPhone() ? 'phone' : 'email',
        target: targetValue(),
        region: state.region
      }), 15000);
    } catch (_) { r = null; }

    state.sending = false;
    if (el.codeBtn && !el.codeBtn.dataset.cooling) el.codeBtn.disabled = false;

    if (!r) { reportApiError(null); refreshCaptcha(); return; }

    if (r.ok && r.data && r.data.ok) {
      state.requestId = r.data.requestId;
      state.requestTarget = currentTargetKey();

      /* 图形码是一次性的：无论成功失败都已经作废，必须换一张 */
      if (el.captchaInput) el.captchaInput.value = '';
      refreshCaptcha();

      if (r.data.deliveredBy === 'demo' && r.data.devCode) {
        toast(fmt(copy().demo.demoCode, { code: r.data.devCode }), 'warn', 9000);
      } else {
        toast(fmt(copy().demo.codeSent, { target: r.data.masked || targetValue() }), 'ok', 5200);
      }
      startCooldown(r.data.cooldown || 60);
      if (el.codeInput) el.codeInput.focus();
      return;
    }

    const code = reportApiError(r);
    if (code === 'CAPTCHA_BAD' || code === 'CAPTCHA_EXPIRED') {
      if (el.captchaInput) { el.captchaInput.value = ''; el.captchaInput.focus(); }
      setError(el.captchaField, el.captchaErr, errText(code));
      refreshCaptcha();
    } else if (code === 'TOO_FAST') {
      startCooldown((r.data && r.data.retryAfter) || 60);
      refreshCaptcha();
    } else {
      refreshCaptcha();
    }
  }

  if (el.codeBtn) {
    el.codeBtn.addEventListener('click', () => {
      if (el.codeBtn.dataset.cooling) return;
      if (!validateTarget()) {
        toast(usesPhone() ? copy().demo.needPhone : copy().demo.needEmail, 'warn');
        return;
      }
      if (online()) sendCodeOnline();
      else sendCodeOffline();
    });
  }

  /* ==================================================================
     15. 提交
     ================================================================== */
  function setLoading(on) {
    state.submitting = on;
    if (!el.submit) return;
    el.submit.classList.toggle('is-loading', on);
    el.submit.disabled = on;
    el.submit.setAttribute('aria-busy', String(on));
  }

  function goNext() {
    window.location.href = NEXT;
  }

  /* 离线预览：没有后端，会话只能存在本地。
     这里明确打上 preview 标记，app.html 读到后会照实说明「预览」，
     不假装成真实登录 */
  function submitOffline() {
    window.setTimeout(() => {
      setLoading(false);
      try {
        localStorage.setItem('lingora.auth.session', JSON.stringify({
          target: targetValue(),
          region: state.region,
          preview: true,
          at: new Date().toISOString()
        }));
      } catch (_) { /* 隐私模式 */ }
      toast(m().okMsg, 'ok', 2600);
      window.setTimeout(goNext, 1100);
    }, 500);
  }

  async function submitOnline() {
    let r = null;
    try {
      r = await API.withTimeout(API.login({
        requestId: state.requestId,
        code: onlyDigits(el.codeInput ? el.codeInput.value : ''),
        target: targetValue(),
        channel: usesPhone() ? 'phone' : 'email',
        region: state.region,
        referral: state.referral || undefined,
        agree: true
      }), 15000);
    } catch (_) { r = null; }

    setLoading(false);

    if (!r) { reportApiError(null); return; }

    if (r.ok && r.data && r.data.ok) {
      state.session = r.data;
      toast(m().okMsg, 'ok', 2600);
      window.setTimeout(goNext, 900);
      return;
    }

    const code = reportApiError(r);
    if (code === 'CODE_BAD' || code === 'CODE_EXPIRED' || code === 'CODE_LOCKED' || code === 'TARGET_CHANGED') {
      setError(el.codeField, el.codeErr, errText(code));
      if (el.codeInput) {
        el.codeInput.value = '';
        el.codeInput.focus();
      }
      if (code !== 'CODE_BAD') {
        state.requestId = '';
        if (online()) refreshCaptcha();
      }
    } else if (code === 'NEED_AGREE') {
      if (el.agreeCheck) el.agreeCheck.parentElement.classList.add('is-invalid');
    }
  }

  if (el.submit) {
    el.submit.addEventListener('click', (ev) => {
      /* 必须拦住原生提交：#authSubmit 是 type="submit"，
         不拦的话浏览器会以 GET 重载本页，把登录请求的结果丢掉 */
      if (ev) ev.preventDefault();
      if (state.submitting) return;

      const c = copy();
      let ok = true;
      clearErrors();

      if (!validateTarget(true)) { validateTarget(false); ok = false; }

      const code = onlyDigits(el.codeInput ? el.codeInput.value : '');
      if (!code) {
        setError(el.codeField, el.codeErr, state.lang === 'zh' ? '请输入验证码' : 'Enter the verification code');
        ok = false;
      } else if (!state.requestId && !state.localCode) {
        setError(el.codeField, el.codeErr, state.lang === 'zh' ? '请先获取验证码' : 'Request a code first');
        ok = false;
      } else if (state.requestTarget && state.requestTarget !== currentTargetKey()) {
        setError(el.codeField, el.codeErr, errText('TARGET_CHANGED'));
        ok = false;
      }

      if (el.agreeCheck && !el.agreeCheck.checked) {
        el.agreeCheck.parentElement.classList.add('is-invalid');
        toast(c.demo.agree, 'warn');
        ok = false;
      }

      if (!ok) return;

      setLoading(true);
      if (online()) submitOnline();
      else submitOffline();
    });
  }

  /* 回车提交 */
  $$('.authform input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (el.submit) el.submit.click();
      }
    });
  });

  /* ==================================================================
     16. 第三方登录（占位，明确告知限制）
     ================================================================== */
  [[el.oauthGoogle, 'Google'], [el.oauthApple, 'Apple']].forEach((pair) => {
    const btn = pair[0];
    if (!btn) return;
    btn.addEventListener('click', () => {
      toast(fmt(copy().demo.oauth, { name: pair[1] }), 'warn', 6000);
    });
  });

  /* ==================================================================
     17. 推荐码
     ================================================================== */
  if (el.referralLink) {
    el.referralLink.addEventListener('click', () => {
      if (el.referralInput) el.referralInput.value = state.referral || '';
      if (el.referralErr) el.referralErr.textContent = '';
      const box = el.referralModal.querySelector('.codefield');
      if (box) box.classList.remove('is-invalid');
      openModal(el.referralModal);
    });
  }

  [[el.referralCancel, () => closeModal(el.referralModal)],
  [el.referralConfirm, () => {
    const v = String(el.referralInput.value || '').trim().toUpperCase();
    if (!v) {
      closeModal(el.referralModal);
      state.referral = '';
      write(STORE.referral, '');
      render();
      return;
    }
    if (!/^[A-Z0-9]{8}$/.test(v)) {
      el.referralModal.querySelector('.codefield').classList.add('is-invalid');
      el.referralErr.textContent = copy().demo.referralBad;
      return;
    }
    state.referral = v;
    write(STORE.referral, v);
    render();
    closeModal(el.referralModal);
    toast(fmt(copy().demo.referralOk, { code: v }), 'ok');
  }]].forEach((pair) => {
    const btn = pair[0];
    if (!btn) return;
    btn.addEventListener('click', pair[1]);
  });

  if (el.referralInput) {
    el.referralInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (el.referralConfirm) el.referralConfirm.click(); }
    });
  }

  /* ==================================================================
     18. 登录 / 注册互跳
     参考站没有独立注册页（登录即注册），这是本站设计稿（屏 3:5）的增补：
     两个页面共用同一套逻辑，只有标题、主按钮与左侧文案不同
     ================================================================== */
  if (el.switchMode) {
    el.switchMode.addEventListener('click', () => {
      const to = MODE === 'register' ? 'login.html' : 'register.html';
      window.location.href = to + (NEXT && NEXT !== 'app.html' ? '?next=' + encodeURIComponent(NEXT) : '');
    });
  }

  /* ==================================================================
     19. 协议链接
     参考站的「用户服务协议 / 隐私协议」是 href 为空的 JS 事件；
     本站同样不含协议全文，因此不跳转，改为给一条明确说明
     ================================================================== */
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href="#terms"], a[href="#privacy"]') : null;
    if (!a) return;
    e.preventDefault();
    toast(copy().demo.terms, 'warn', 5200);
  });

  /* ==================================================================
     20. 初始化
     ================================================================== */
  async function init() {
    render();

    /* 没有区域记录 → 先弹区域选择（这是参考站的必经前置步骤） */
    if (!read(STORE.region, '')) {
      state.lang = 'zh';
      render();
      window.setTimeout(openRegion, 220);
    }

    /* 探测后端。不可达就降级为离线预览，并在徽标上说清楚 */
    try {
      const r = await API.withTimeout(API.health(), 4000);
      state.backend = (r.ok && r.data && r.data.ok) ? 'online' : 'offline';
    } catch (_) {
      state.backend = 'offline';
    }

    if (!online()) {
      if (el.captchaImg) setCaptchaImage(CAPTCHA_PLACEHOLDER);
      render();
      window.setTimeout(() => toast(copy().demo.offline, 'warn', 6000), 700);
      return;
    }

    /* 在线：图形码就位，同时查一下是不是已经登录过 */
    render();
    refreshCaptcha();

    try {
      const s = await API.session();
      if (s.ok && s.data && s.data.authed) {
        state.session = s.data;
        render();
        toast(fmt(copy().demo.welcomeBack, { target: s.data.target }), 'ok', 3200);
        window.setTimeout(goNext, 1400);
      }
    } catch (_) { /* 会话查询失败不影响手动登录 */ }
  }

  init();
})();
