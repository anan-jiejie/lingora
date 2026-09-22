/* ==========================================================================
   Lingora 灵语同传 · 站点交互
   1) 导航：滚动毛玻璃 / 移动端菜单 / 当前区块高亮
   2) Hero 实时同传演示窗：语言对切换 + 逐字输入 + 计时 + 循环
   3) 滚动揭示动画与数据滚动计数
   4) 价格方案：货币切换
   5) FAQ 手风琴
   6) 返回顶部
   ========================================================================== */
(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     动效层交接开关
     ------------------------------------------------------------------
     assets/motion.js 是后加载的 GSAP 动效层。凡它接管的动画（滚动揭示、
     数字计数、首屏入场），本文件就不再插手 —— 两套东西同时写 opacity
     与 transform 只会互相打架。

     判定条件必须与 motion.js 的守卫完全一致：
       · 用户未开启「减少动效」，且
       · GSAP 三个文件都成功加载
     任何一条不满足，都回落到本文件原有的 IntersectionObserver 实现。
     ------------------------------------------------------------------ */
  const gsapActive =
    !reduced && typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  /* ------------------------------------------------------------------
     1. 导航
     ------------------------------------------------------------------ */
  const nav = $('#nav');
  const navLinks = $$('#navLinks a');
  const burger = $('#burger');
  const mobileMenu = $('#mobileMenu');

  function onScrollNav() {
    if (!nav) return;
    nav.classList.toggle('is-scrolled', window.scrollY > 12);
  }
  onScrollNav();
  window.addEventListener('scroll', onScrollNav, { passive: true });

  function closeMenu() {
    if (!burger || !mobileMenu) return;
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', '打开导航菜单');
    mobileMenu.classList.remove('is-open');
    mobileMenu.hidden = true;
    nav.classList.remove('is-open');
  }

  if (burger && mobileMenu) {
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') !== 'true';
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
      mobileMenu.hidden = !open;
      mobileMenu.classList.toggle('is-open', open);
      nav.classList.toggle('is-open', open);
    });
    mobileMenu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') closeMenu();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  /* 当前区块高亮 */
  const spyTargets = navLinks
    .map((a) => {
      const id = a.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      return el ? { link: a, el } : null;
    })
    .filter(Boolean);

  if (spyTargets.length && 'IntersectionObserver' in window) {
    const visible = new Set();
    const syncActive = () => {
      navLinks.forEach((a) => a.classList.remove('is-active'));
      if (!visible.size) return; // 顶部或有空隙时不高亮，避免残留上一节
      const first = spyTargets.find((t) => visible.has(t.el.id));
      if (first) first.link.classList.add('is-active');
    };
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });
        syncActive();
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    spyTargets.forEach((t) => spy.observe(t.el));
  }

  /* ------------------------------------------------------------------
     2. Hero 实时转写演示窗
     小字（着色）= 实时识别流，尚未加标点
     大字（白色）= 经过断句与标点整理后的最终文本
     ------------------------------------------------------------------ */
  const DEMO_MODES = {
    zh: {
      label: '中文',
      turns: [
        {
          meta: '说话人 A · 00:03',
          src: '大家早上好我们开始今天的会议',
          dst: '大家早上好，我们开始今天的会议。',
          tone: 'mint'
        },
        {
          meta: '说话人 B · 00:11',
          src: '好的我先把第一季度的数据调出来',
          dst: '好的，我先把第一季度的数据调出来。',
          tone: 'coral'
        }
      ]
    },
    en: {
      label: 'English',
      turns: [
        {
          meta: 'Speaker A · 00:03',
          src: 'good morning everyone lets begin today meeting',
          dst: "Good morning, everyone. Let's begin today's meeting.",
          tone: 'mint'
        },
        {
          meta: 'Speaker B · 00:11',
          src: 'sure let me pull up the q one numbers first',
          dst: 'Sure, let me pull up the Q1 numbers first.',
          tone: 'coral'
        }
      ]
    },
    ja: {
      label: '日本語',
      turns: [
        {
          meta: '話者 A · 00:03',
          src: 'おはようございますそれでは会議を始めましょう',
          dst: 'おはようございます。それでは会議を始めましょう。',
          tone: 'mint'
        },
        {
          meta: '話者 B · 00:11',
          src: 'はいまず第一四半期のデータを確認します',
          dst: 'はい、まず第一四半期のデータを確認します。',
          tone: 'coral'
        }
      ]
    }
  };

  const demoTurns = $('#demoTurns');
  const demoRoot = $('#demo');
  const demoLang = $('#demoLang');
  const demoTimer = $('#demoTimer');
  const switchBtns = $$('.demo__switch button');

  let runToken = 0;      // 用于取消上一轮循环
  let timerHandle = null;
  let elapsed = 84;      // 01:24

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmt(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function paintTimer() {
    if (demoTimer) demoTimer.textContent = fmt(elapsed);
  }

  function startTimer() {
    stopTimer();
    timerHandle = window.setInterval(() => {
      elapsed += 1;
      if (elapsed > 2400) elapsed = 84;
      paintTimer();
    }, 1000);
  }
  function stopTimer() {
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
  }

  function buildTeam(pair, animated) {
    if (!demoTurns) return { turnEls: [] };
    demoTurns.innerHTML = '';
    return pair.turns.map((t) => {
      const wrap = document.createElement('div');
      wrap.className = 'turn';

      const meta = document.createElement('p');
      meta.className = 'turn__meta';
      meta.textContent = t.meta;

      const src = document.createElement('p');
      src.className = 'turn__src' + (t.tone === 'coral' ? ' turn__src--coral' : '');

      const dst = document.createElement('p');
      dst.className = 'turn__dst';

      if (!animated) {
        src.textContent = t.src;
        dst.textContent = t.dst;
      }

      wrap.append(meta, src, dst);
      demoTurns.appendChild(wrap);

      return { src, dst, text: t };
    });
  }

  function setCaret(el) {
    const caret = document.createElement('span');
    caret.className = 'caret';
    el.appendChild(caret);
    return caret;
  }

  async function typeInto(el, text, speed, token) {
    const caret = setCaret(el);
    el.insertBefore(document.createTextNode(''), caret);
    for (let i = 0; i < text.length; i += 1) {
      if (token !== runToken) { caret.remove(); return false; }
      caret.insertAdjacentText('beforebegin', text[i]);
      // 标点后稍作停顿，模拟自然语流
      const ch = text[i];
      const pause = /[，。！？,.!?；;]/.test(ch) ? speed * 5 : speed;
      await sleep(pause);
    }
    caret.remove();
    return true;
  }

  async function runDemo(modeKey) {
    const pair = DEMO_MODES[modeKey];
    if (!pair || !demoTurns) return;

    runToken += 1;
    const token = runToken;

    if (demoLang) demoLang.textContent = pair.label;

    if (demoRoot) {
      demoRoot.classList.add('is-swapping');
      window.setTimeout(() => demoRoot.classList.remove('is-swapping'), 340);
    }

    if (reduced) {
      buildTeam(pair, false);
      paintTimer();
      return;
    }

    buildTeam(pair, true);
    const els = $$('.turn', demoTurns).map((wrap) => ({
      src: $('.turn__src', wrap),
      dst: $('.turn__dst', wrap)
    }));

    while (token === runToken) {
      startTimer();
      for (let i = 0; i < pair.turns.length; i += 1) {
        const el = els[i];
        const t = pair.turns[i];
        if (!el) continue;
        el.src.textContent = '';
        el.dst.textContent = '';

        const okSrc = await typeInto(el.src, t.src, 24, token);
        if (!okSrc || token !== runToken) { stopTimer(); return; }
        await sleep(180);
        if (token !== runToken) { stopTimer(); return; }

        const okDst = await typeInto(el.dst, t.dst, 42, token);
        if (!okDst || token !== runToken) { stopTimer(); return; }
        await sleep(560);
        if (token !== runToken) { stopTimer(); return; }
      }
      await sleep(2600);
      if (token !== runToken) { stopTimer(); return; }
    }
    stopTimer();
  }

  if (demoTurns) {
    switchBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.pair;
        switchBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        runDemo(key);
      });
    });

    // 首屏进入后启动演示（默认中文，与首屏高亮的按钮一致）
    const startDemo = () => runDemo('zh');
    if ('IntersectionObserver' in window) {
      const demoObs = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            startDemo();
            demoObs.disconnect();
          }
        },
        { threshold: 0.25 }
      );
      demoObs.observe(demoRoot || demoTurns);
    } else {
      startDemo();
    }
  }

  /* ------------------------------------------------------------------
     3. 滚动揭示 + 数字计数
     动效层就绪时这两段整体跳过，交给 GSAP 的 ScrollTrigger.batch
     ------------------------------------------------------------------ */
  const revealEls = $$('[data-reveal]');
  if (gsapActive) {
    /* GSAP 接管：什么都不做。
       首屏的 [data-reveal] 由 motion.js 的时间轴负责，
       首屏之外的由 ScrollTrigger.batch 负责。 */
  } else if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  } else {
    const revealObs = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    revealEls.forEach((el) => revealObs.observe(el));
  }

  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

  function animateCount(el) {
    const target = parseFloat(el.dataset.count);
    if (Number.isNaN(target)) return;
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1500;
    const t0 = performance.now();

    function frame(now) {
      const p = Math.min((now - t0) / duration, 1);
      const value = target * easeOutQuart(p);
      el.textContent =
        prefix +
        value.toLocaleString('zh-CN', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }) +
        suffix;
      if (p < 1) requestAnimationFrame(frame);
      else {
        el.textContent =
          prefix +
          target.toLocaleString('zh-CN', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
          }) +
          suffix;
      }
    }
    requestAnimationFrame(frame);
  }

  const counters = $$('[data-count]');
  if (counters.length) {
    if (gsapActive) {
      /* GSAP 接管：由 motion.js 的 countUp() 用补间驱动数字
         （比手写 requestAnimationFrame + easeOutQuart 更易与整站节奏对齐） */
    } else if (reduced || !('IntersectionObserver' in window)) {
      // 保持 HTML 里的静态文本，不再动画
    } else {
      const countObs = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            animateCount(entry.target);
            obs.unobserve(entry.target);
          });
        },
        { threshold: 0.4 }
      );
      counters.forEach((el) => countObs.observe(el));
    }
  }

  /* ------------------------------------------------------------------
     4. 价格方案 · 货币切换
     ------------------------------------------------------------------ */
  const currencyBtns = $$('.currency button');
  if (currencyBtns.length) {
    const amounts = $$('[data-cny]');
    currencyBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.currency;
        currencyBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        amounts.forEach((el) => {
          const next = el.dataset[code];
          if (!next) return;
          // 数字轻微翻动，强化「换算了」的反馈
          el.style.transition = 'none';
          el.style.opacity = '0';
          el.style.transform = 'translateY(6px)';
          requestAnimationFrame(() => {
            el.textContent = next;
            el.style.transition = 'opacity .28s ease, transform .28s ease';
            el.style.opacity = '1';
            el.style.transform = 'none';
          });
        });
      });
    });
  }

  /* ------------------------------------------------------------------
     5. FAQ 手风琴
     ------------------------------------------------------------------ */
  const accs = $$('.acc');
  accs.forEach((acc) => {
    const q = $('.acc__q', acc);
    if (!q) return;
    q.addEventListener('click', () => {
      const willOpen = !acc.classList.contains('is-open');
      accs.forEach((other) => {
        other.classList.remove('is-open');
        const oq = $('.acc__q', other);
        if (oq) oq.setAttribute('aria-expanded', 'false');
      });
      if (willOpen) {
        acc.classList.add('is-open');
        q.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ------------------------------------------------------------------
     6. 返回顶部
     ------------------------------------------------------------------ */
  const toTop = $('#toTop');
  if (toTop) {
    const onScrollTop = () => {
      toTop.classList.toggle('is-visible', window.scrollY > 900);
    };
    onScrollTop();
    window.addEventListener('scroll', onScrollTop, { passive: true });
    toTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  /* 首帧：确保 Hero 内容不被 reveal 卡住
     动效层接管时不能执行 —— 提前加 is-visible 会把 GSAP 的入场起点
     直接抹掉，首屏就会「瞬间出现」而不是逐行推出 */
  if (!gsapActive) {
    window.addEventListener('load', () => {
      $$('.hero [data-reveal]').forEach((el) => el.classList.add('is-visible'));
    });
  }
})();
