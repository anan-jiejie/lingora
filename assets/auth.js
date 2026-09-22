/* ==========================================================================
   Lingora · 账户页逻辑（登录 / 注册 / 找回密码）
   文件：assets/auth.js
   --------------------------------------------------------------------------
   这一层负责「事」，不负责「动」：
     · 动效（入场、进度条、降级链）复用 assets/motion.js，本文件不介入
     · 功能逻辑（区域选择、语言切换、tab、校验、验证码、提交）都在这里

   ⚠️ 关于「后端」的边界（重要，别误读）
   本站是纯静态站，没有服务端。因此：
     · 验证码是**前端演示码**，点击后直接显示在提示条里，不发短信/邮件
     · 登录态用 localStorage 模拟，真实产品应由服务端下发 HttpOnly Cookie
     · 第三方登录（Google / Apple）需要 Client ID + 服务端回调，此处仅保留入口
   这些边界在界面上都有明确标注，不做「看起来能用其实没接」的假象。
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
        code: '验证码',
        phonePh: '请输入手机号',
        emailPh: '请输入邮箱地址',
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
        flag: '前端演示模式 · 未接入真实后端',
        codeSent: '演示验证码：{code}（真实环境由短信 / 邮件下发）',
        codeBad: '验证码不正确，请查看提示条里的演示码',
        needPhone: '请先填写手机号',
        needEmail: '请先填写邮箱',
        phoneBad: '手机号格式不对，请输入 11 位中国大陆手机号',
        emailBad: '邮箱格式不对，请检查后重试',
        agree: '请先勾选同意服务协议与隐私政策',
        oauth: '{name} 登录需要客户端 ID 与服务端回调，静态站无法完成。接入方式见 README。',
        referralOk: '推荐码 {code} 已记录（演示）',
        referralBad: '推荐码需为 8 位字母或数字',
        terms: '演示站未包含协议全文，正式上线前需接入法务文案'
      },

      /* 左侧品牌区文案（随语言切换） */
      aside: {
        eyebrow: '账户',
        title: '登录，把每一场会议变成可检索的文字',
        lead: 'Lingora 把实时转写、双语翻译与会议记录放进同一个窗口。登录后即可延续你的会议历史与偏好设置。',
        p1: '<strong>音频只在会话内处理</strong>，结束后不保留原始录音',
        p2: '<strong>中英日韩</strong>边听边出译文，可开双语字幕',
        p3: '随便哪个会议窗口<strong>都能听</strong>，不用切软件',
        note: '本站是纯前端演示站：验证码不会真实下发，登录态只存在你的浏览器本地。正式部署时这些都由服务端接管。'
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
            note: '参考产品把注册并进了登录（首次验证码登录即完成注册），没有单独的注册页；这一页是按本站设计稿（屏 3:5）保留的独立入口，功能边界与登录页完全一致。'
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
        code: 'Verification code',
        phonePh: 'Enter phone number',
        emailPh: 'Enter email address',
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
        flag: 'Front-end demo · no backend connected',
        codeSent: 'Demo code: {code} (production sends via SMS / email)',
        codeBad: 'Incorrect code — check the demo code in the toast',
        needPhone: 'Enter your phone number first',
        needEmail: 'Enter your email first',
        phoneBad: 'Invalid phone number',
        emailBad: 'Invalid email address',
        agree: 'Please agree to the terms and privacy policy first',
        welcome: 'Signed in. Opening the workspace…',
        oauth: '{name} sign-in requires a client ID and a server callback — not possible on a static site. See README for the wiring.',
        referralOk: 'Referral {code} saved (demo)',
        referralBad: 'Referral code must be 8 letters or digits',
        terms: 'Terms text is not part of this demo — wire in legal copy before launch'
      },
      aside: {
        eyebrow: 'Account',
        title: 'Sign in and turn every meeting into searchable text',
        lead: 'Lingora puts live transcription, bilingual translation and meeting notes in one window. Sign in to pick up your history and preferences.',
        p1: '<strong>Audio is processed in-session only</strong> — raw recordings are not kept',
        p2: '<strong>Chinese, English, Japanese, Korean</strong> translated as you listen, with dual subtitles',
        p3: 'Works alongside <strong>any meeting window</strong> — no app switching',
        note: 'This is a front-end demo: codes are not really sent and the session lives only in your browser. A real deployment hands all of this to a server.'
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
            note: 'The reference product folds sign-up into sign-in (your first code login creates the account) and has no dedicated page. This page keeps the standalone entry from our design file (screen 3:5); the front-end limits are identical.'
          }
        }
      }
    }
  };

  const STORE = {
    region: 'lingora.auth.region',
    lang: 'lingora.auth.lang',
    referral: 'lingora.auth.referral',
    session: 'lingora.auth.session'
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

  /* ==================================================================
     2. 状态
     ================================================================== */
  const state = {
    region: read(STORE.region, '') || 'cn',
    lang: read(STORE.lang, '') || 'zh',
    tab: 'phone',
    referral: read(STORE.referral, '') || '',
    demoCode: '',
    sending: false,
    submitting: false
  };

  if (!read(STORE.region, '')) {
    /* 首次访问：区域与语言保持默认，弹窗由 init 打开 */
  }

  const copy = () => COPY[state.lang];
  const m = () => copy().mode[MODE];
  const t = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), copy());

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
    return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m));
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

  /* ==================================================================
     4. DOM 引用
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

  /* ==================================================================
     5. 渲染：把文案刷到界面上
     ================================================================== */
  const visibleFields = () =>
    state.region === 'cn' && state.tab === 'phone' ? ['phone', 'code'] : ['email', 'code'];

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
    if (el.codeLabel) el.codeLabel.textContent = c.field.code;
    if (el.codeInput) el.codeInput.placeholder = c.field.codePh;
    if (el.codeBtn && !el.codeBtn.dataset.cooling) el.codeBtn.textContent = c.field.getCode;

    /* 可见字段 */
    const vis = visibleFields();
    if (el.phoneField) el.phoneField.hidden = !vis.includes('phone');
    if (el.emailField) el.emailField.hidden = !vis.includes('email');

    /* 协议 */
    if (el.agreeText) {
      el.agreeText.innerHTML =
        c.agree.pre + ' <a href="#terms">' + c.agree.terms + '</a> ' +
        c.agree.and + ' <a href="#privacy">' + c.agree.privacy + '</a>。';
    }

    if (el.submitLabel) el.submitLabel.textContent = md.submit;
    if (el.orText) el.orText.textContent = c.or;

    /* 第三方：中国区只有 Apple，国际区 Google + Apple（照参考站） */
    if (el.oauthGoogle) el.oauthGoogle.hidden = state.region !== 'intl';
    if (el.oauthGoogle) el.oauthGoogle.querySelector('[data-slot]').textContent = c.oauth.google;
    if (el.oauthApple) el.oauthApple.querySelector('[data-slot]').textContent = c.oauth.apple;

    /* 推荐码 */
    if (el.referralLink) {
      const set = !!state.referral;
      el.referralLink.textContent = set
        ? fmt(c.referral.linkSet, { code: state.referral })
        : c.referral.link;
      el.referralLink.classList.toggle('is-set', set);
    }
    const rm = $('#referralTitle');
    if (rm) rm.textContent = c.referral.title;
    const rd = $('#referralDesc');
    if (rd) rd.textContent = c.referral.desc;
    if (el.referralInput) el.referralInput.placeholder = c.referral.ph;
    if (el.referralCancel) el.referralCancel.textContent = c.referral.cancel;
    if (el.referralConfirm) el.referralConfirm.textContent = c.referral.confirm;

    if (el.demoFlag) el.demoFlag.querySelector('[data-slot]').textContent = c.demo.flag;

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
     6. Toast
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
     7. 弹窗开关（含焦点管理与 Esc）
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
    if (el.referralModal && !el.referralModal.hidden) return closeModal(el.referralModal);
    if (el.regionModal && !el.regionModal.hidden && state.region) return closeModal(el.regionModal);
  });

  $$('.modal').forEach((m) => {
    const mask = $('.modal__mask', m);
    if (mask) mask.addEventListener('click', () => {
      /* 区域选择是必经步骤，不允许点遮罩跳过 */
      if (m === el.regionModal) return;
      closeModal(m);
    });
  });

  /* ==================================================================
     8. 区域选择
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
      if (state.region === 'cn' && state.lang === 'en') state.tab = state.tab;
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
     9. Tab 切换
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
      render();
      segIndicator();
      const focusTarget = state.tab === 'phone' ? el.phoneInput : el.emailInput;
      if (focusTarget) focusTarget.focus();
    });
  });

  /* ==================================================================
     10. 校验
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
    setError(el.codeField, el.codeErr, '');
    if (el.agreeCheck) el.agreeCheck.parentElement.classList.remove('is-invalid');
  }

  const usesPhone = () => state.region === 'cn' && state.tab === 'phone';

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

  if (el.phoneInput) {
    el.phoneInput.addEventListener('input', () => {
      const raw = onlyDigits(el.phoneInput.value);
      const pos = el.phoneInput.selectionStart;
      el.phoneInput.value = groupPhone(raw);
      /* 光标保持在数字流的位置，避免格式化把光标弹到末尾 */
      if (pos != null) {
        const shift = el.phoneInput.value.length - (el.phoneInput.value.replace(/\s/g, '').length - raw.length);
        try { el.phoneInput.setSelectionRange(Math.min(pos, el.phoneInput.value.length), Math.min(pos, el.phoneInput.value.length)); } catch (_) { /* noop */ }
      }
      if (el.phoneField.classList.contains('is-invalid')) validateTarget();
    });
  }

  if (el.emailInput) {
    el.emailInput.addEventListener('blur', () => {
      if (el.emailInput.value && !isEmail(el.emailInput.value)) validateTarget();
      else setError(el.emailField, el.emailErr, '');
    });
  }

  if (el.codeInput) {
    el.codeInput.addEventListener('input', () => {
      el.codeInput.value = onlyDigits(el.codeInput.value).slice(0, 6);
      setError(el.codeField, el.codeErr, '');
    });
  }

  if (el.ccButton) {
    /* 国家码：参考站是下拉，这里做一个轻量的循环切换（+86 / +852 / +886 / +1）
       真实产品应替换为完整国家码选择器 */
    const CODES = ['+86', '+852', '+886', '+1'];
    el.ccButton.addEventListener('click', () => {
      const cur = CODES.indexOf(el.ccButton.dataset.code || '+86');
      const next = CODES[(cur + 1) % CODES.length];
      el.ccButton.dataset.code = next;
      el.ccButton.querySelector('[data-slot]').textContent = next;
      const hint = state.lang === 'zh'
        ? '国家码已切换为 ' + next + '（演示为本地循环切换）'
        : 'Country code set to ' + next + ' (local demo cycle)';
      toast(hint, 'ok', 2600);
    });
  }

  /* ==================================================================
     11. 获取验证码（前端演示）
     ================================================================== */
  let coolTimer = null;

  function startCooldown(sec) {
    let left = sec;
    const c = copy();
    el.codeBtn.dataset.cooling = '1';
    el.codeBtn.disabled = true;
    el.codeBtn.textContent = fmt(c.field.resend, { n: left });
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

  if (el.codeBtn) {
    el.codeBtn.addEventListener('click', () => {
      if (!validateTarget()) {
        toast(usesPhone() ? copy().demo.needPhone : copy().demo.needEmail, 'warn');
        return;
      }
      /* 演示码：真实环境这里应调用短信 / 邮件接口，并把校验放到服务端 */
      state.demoCode = String(Math.floor(100000 + Math.random() * 900000));
      toast(fmt(copy().demo.codeSent, { code: state.demoCode }), 'ok', 9000);
      startCooldown(60);
      if (el.codeInput) el.codeInput.focus();
    });
  }

  /* ==================================================================
     12. 提交
     ================================================================== */
  function setLoading(on) {
    state.submitting = on;
    if (!el.submit) return;
    el.submit.classList.toggle('is-loading', on);
    el.submit.disabled = on;
    el.submit.setAttribute('aria-busy', String(on));
  }

  if (el.submit) {
    el.submit.addEventListener('click', (ev) => {
      /* 必须拦住原生提交：#authSubmit 是 type="submit"，
         不拦的话浏览器会以 GET 重载本页，与「900ms 后写会话再跳 app.html」抢跑，
         表现为偶发提交后停在 login.html? 且会话丢失 */
      if (ev) ev.preventDefault();
      const c = copy();
      if (state.submitting) return;

      let ok = true;
      clearErrors();
      if (!validateTarget(true)) { validateTarget(false); ok = false; }

      const code = onlyDigits(el.codeInput ? el.codeInput.value : '');
      if (!code) {
        setError(el.codeField, el.codeErr, state.lang === 'zh' ? '请输入验证码' : 'Enter the verification code');
        ok = false;
      } else if (state.demoCode && code !== state.demoCode) {
        setError(el.codeField, el.codeErr, c.demo.codeBad);
        ok = false;
      } else if (!state.demoCode) {
        setError(el.codeField, el.codeErr, state.lang === 'zh' ? '请先获取验证码' : 'Request a code first');
        ok = false;
      }

      if (el.agreeCheck && !el.agreeCheck.checked) {
        el.agreeCheck.parentElement.classList.add('is-invalid');
        toast(c.demo.agree, 'warn');
        ok = false;
      }

      if (!ok) return;

      setLoading(true);
      window.setTimeout(() => {
        /* ⚠️ 这是前端模拟会话。真实产品应由服务端校验并下发 HttpOnly Cookie，
           前端不应自行判定登录成功。 */
        write(STORE.session, JSON.stringify({
          target: targetValue(),
          region: state.region,
          referral: state.referral || null,
          at: new Date().toISOString()
        }));
        setLoading(false);
        toast(m().okMsg, 'ok', 2600);
        window.setTimeout(() => { window.location.href = 'app.html'; }, 1100);
      }, 900);
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
     13. 第三方登录（占位，明确告知限制）
     ================================================================== */
  [[el.oauthGoogle, 'Google'], [el.oauthApple, 'Apple']].forEach(([btn, name]) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      toast(fmt(copy().demo.oauth, { name }), 'warn', 6000);
    });
  });

  /* ==================================================================
     14. 推荐码
     ================================================================== */
  if (el.referralLink) {
    el.referralLink.addEventListener('click', () => {
      if (el.referralInput) el.referralInput.value = state.referral || '';
      el.referralErr.textContent = '';
      el.referralModal.querySelector('.codefield').classList.remove('is-invalid');
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
   }]].forEach(([btn, fn]) => {
    if (!btn) return;
    btn.addEventListener('click', fn);
  });

  if (el.referralInput) {
    el.referralInput.addEventListener('input', () => {
      el.referralInput.value = String(el.referralInput.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      el.referralErr.textContent = '';
      el.referralModal.querySelector('.codefield').classList.remove('is-invalid');
    });
    el.referralInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (el.referralConfirm) el.referralConfirm.click(); }
    });
  }

  /* ==================================================================
     15. 登录 / 注册互跳
     参考站没有独立注册页（登录即注册），这是本站设计稿（屏 3:5）的增补：
     两个页面共用同一套逻辑，只有标题、主按钮与左侧文案不同
     ================================================================== */
  if (el.switchMode) {
    el.switchMode.addEventListener('click', () => {
      window.location.href = MODE === 'register' ? 'login.html' : 'register.html';
    });
  }

  /* ==================================================================
     16. 协议链接
     参考站的「用户服务协议 / 隐私协议」是 href 为空的 JS 事件；
     演示站同样不含协议全文，因此不跳转，改为给一条明确说明
     ================================================================== */
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href="#terms"], a[href="#privacy"]') : null;
    if (!a) return;
    e.preventDefault();
    toast(copy().demo.terms, 'warn', 5200);
  });

  /* ==================================================================
     17. 初始化
     ================================================================== */
  render();

  /* 已有区域记录 → 直接把界面拉到对应语言；
     没有 → 弹区域选择（这是参考站的必经前置步骤） */
  if (!read(STORE.region, '')) {
    state.lang = 'zh';
    render();
    window.setTimeout(() => openRegion(), 220);
  }

  /* 已登录过就不必重复登录，但保留手动进入的权利（不强制跳转） */
  if (read(STORE.session, '')) {
    const info = (() => { try { return JSON.parse(read(STORE.session, '{}')); } catch (_) { return {}; } })();
    if (info && info.target) {
      const tip = state.lang === 'zh'
        ? '你已登录过（' + info.target + '），继续登录会覆盖当前会话'
        : 'Already signed in as ' + info.target + ' — signing in again replaces the session';
      window.setTimeout(() => toast(tip, 'ok', 5000), 900);
    }
  }
})();
