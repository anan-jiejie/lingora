/* ==========================================================================
   Lingora 灵语同传 · 动效层
   文件：assets/motion.js
   依赖：assets/vendor/gsap/{gsap,ScrollTrigger,CustomEase}.min.js（同源自托管）
   --------------------------------------------------------------------------
   这一层只做「动」，不做「事」：
     · 功能逻辑（导航、汉堡菜单、演示窗打字机、FAQ 开关状态、货币切换）
       仍然全部由 main.js 负责，本文件不抢它的活
     · 它接管的是 reveal 的入场方式与数字计数 —— main.js 里对应两段逻辑
       会通过 gsapActive 开关主动让位，避免两套动画同时写同一批属性

   降级链（从强到弱，任一层断裂都不影响页面可用）：
     1) 允许动效 + GSAP 就绪 → 本层全量接管
     2) 用户开启「减少动效」   → 本层直接 return，main.js 原生分支给终态
     3) GSAP 文件加载失败     → 本层 return，main.js 的 IntersectionObserver 兜底
   ========================================================================== */
(function () {
  'use strict';

  const html = document.documentElement;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* 守卫 1：GSAP 未就绪 —— 直接让位给 main.js 的兜底逻辑 */
  if (!window.gsap || !window.ScrollTrigger) return;

  /* 守卫 2：用户偏好减少动效 —— 让位给 main.js 的 reduced 分支，一帧都不跑 */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  const CustomEase = window.CustomEase;

  gsap.registerPlugin(ScrollTrigger);
  if (CustomEase) gsap.registerPlugin(CustomEase);

  /* 接管声明：此刻起，[data-reveal] 的 CSS transition 由 motion.css 关闭 */
  html.classList.add('has-gsap');

  /* ------------------------------------------------------------------
     缓动：复刻 styles.css 里 --ease / --ease-out 的同一组贝塞尔值
     这么做是为了让 GSAP 的曲线与站点既有 CSS 动画手感完全一致，
     而不是「引了个新库就换一套节奏」
     ------------------------------------------------------------------ */
  if (CustomEase) {
    CustomEase.create('lingora-ease', '0.22, 0.61, 0.36, 1');
    CustomEase.create('lingora-out', '0.16, 1, 0.3, 1');
  }
  const EASE_OUT = CustomEase ? 'lingora-out' : 'power3.out';
  const EASE_STD = CustomEase ? 'lingora-ease' : 'power2.out';

  const isFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ==================================================================
     A. 顶部滚动进度条
     ================================================================== */
  (function progressBar() {
    const bar = document.createElement('div');
    bar.className = 'lingora-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.35 }
    });
  })();

  /* ==================================================================
     B. 首屏入场时间轴
     一个 master timeline 把「徽章 → 标题 → 正文 → 按钮 → 演示窗 → 合规条」
     编排成一次连贯的亮相，而不是各自为政的 delay 堆叠
     ================================================================== */

  /* 按 <br> 把标题拆成逐行遮罩，让文字像从底下推出来 */
  function splitLines(el) {
    if (!el || el.dataset.lingoraLines === '1') {
      return el ? $$('.lingora-line > span', el) : [];
    }
    // 只在结构足够简单时动手，避免误伤带嵌套标签的标题
    const hasBlockChild = Array.from(el.children).some(
      (c) => c.tagName.toLowerCase() !== 'br'
    );
    if (hasBlockChild) return [];

    const parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = parts
      .map((p) => '<span class="lingora-line"><span>' + p.trim() + '</span></span>')
      .join('');
    el.dataset.lingoraLines = '1';
    return $$('.lingora-line > span', el);
  }

  function playHero() {
    const hero = $('.hero');
    if (!hero) return;

    /* 首屏的 [data-reveal] 先全部置为 CSS 终态（opacity:1），
       紧接着在同一个同步任务里用 gsap.from 把它们推回起点。
       中间没有让出渲染帧，所以不会出现「闪一下再动画」 */
    $$('[data-reveal]', hero).forEach((el) => el.classList.add('is-visible'));

    const titleLines = splitLines($('.hero__title'));

    const tl = gsap.timeline({
      defaults: { duration: 0.8, ease: EASE_OUT },
      delay: 0.1
    });

    tl.from('.chip--live', { autoAlpha: 0, y: 14, duration: 0.5 }, 0.05);

    if (titleLines.length) {
      tl.from(
        titleLines,
        { yPercent: 116, duration: 0.95, stagger: 0.1, ease: 'expo.out' },
        0.12
      );
    } else {
      // 结构不适合拆行时的降级：整块上浮
      tl.from('.hero__title', { autoAlpha: 0, y: 26 }, 0.12);
    }

    tl.from('.hero__sub', { autoAlpha: 0, y: 18 }, 0.4)
      .from('.hero__ctas .btn', { autoAlpha: 0, y: 16, stagger: 0.08 }, 0.5)
      .from('.hero__trust', { autoAlpha: 0, y: 12 }, 0.62);

    /* 演示窗从右侧带一点 3D 侧身入场，落地后再摆正 */
    tl.from(
      '.demo',
      {
        autoAlpha: 0,
        x: 52,
        rotationY: -7,
        transformPerspective: 1100,
        transformOrigin: 'left center',
        duration: 1
      },
      0.28
    )
      .from('.demo__switch button', { autoAlpha: 0, y: 12, stagger: 0.06 }, 0.66)
      .from('.demo__hint', { autoAlpha: 0, duration: 0.5 }, 0.76)
      .from('.compliance li', { autoAlpha: 0, y: 14, stagger: 0.07 }, 0.72);

    return tl;
  }

  /* ==================================================================
     C. 滚动入场（除首屏外的全部 [data-reveal]）
     ================================================================== */

  /* 这几块内部是「列表 / 阵列」，交给各自的分组动画处理层次感，
     比整块一起淡入更有节奏 */
  const GROUPED = ['.softlist', '.stats', '.cta__inner', '#faqList'];

  function isGrouped(el) {
    return GROUPED.some((sel) => el.matches(sel));
  }

  const scrollReveals = $$('[data-reveal]').filter((el) => {
    if (el.closest('.hero')) return false;
    if (isGrouped(el)) return false;
    return true;
  });

  /* ==================================================================
     D. 卡片 3D 倾斜（仅宽屏 + 精确指针）
     ================================================================== */
  function bindTilt(cards) {
    if (!isFinePointer || !cards.length) return;

    cards.forEach((card) => {
      card.classList.add('lingora-tilt');
      const scope = card.parentElement;
      if (scope) scope.classList.add('lingora-tilt-scope');

      const rx = gsap.quickTo(card, 'rotationX', { duration: 0.55, ease: 'power3.out' });
      const ry = gsap.quickTo(card, 'rotationY', { duration: 0.55, ease: 'power3.out' });
      const ty = gsap.quickTo(card, 'y', { duration: 0.45, ease: 'power3.out' });

      const onMove = (e) => {
        const r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        ry(px * 6.5);
        rx(-py * 5.5);
        ty(-6);
      };

      const reset = () => {
        rx(0);
        ry(0);
        ty(0);
      };

      card.addEventListener('pointermove', onMove);
      card.addEventListener('pointerleave', reset);
      card.addEventListener('blur', reset, true);
    });
  }

  /* ==================================================================
     E. 数字计数（GSAP 版，替下 main.js 的 requestAnimationFrame 版）
     ================================================================== */
  function countUp(el, delay) {
    const target = parseFloat(el.dataset.count);
    if (Number.isNaN(target)) return;

    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';

    const pretty = (v) =>
      prefix +
      v.toLocaleString('zh-CN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) +
      suffix;

    const box = { v: 0 };
    gsap.to(box, {
      v: target,
      duration: 1.5,
      delay: delay || 0,
      ease: EASE_OUT,
      onUpdate() {
        el.textContent = pretty(box.v);
      },
      onComplete() {
        el.textContent = pretty(target);
      }
    });
  }

  /* ==================================================================
     F. 分组入场：软列表 / 数据条 / 结尾号召
     ================================================================== */
  function groupedReveals() {
    /* 配合软件：8 个标签像筹码一样逐个弹上来 */
    const softlist = $('.softlist');
    if (softlist) {
      softlist.classList.add('is-visible');
      gsap.from($$('span', softlist), {
        autoAlpha: 0,
        y: 18,
        scale: 0.94,
        duration: 0.55,
        ease: 'back.out(1.5)',
        stagger: { each: 0.055, from: 'start' },
        scrollTrigger: { trigger: softlist, start: 'top 88%', once: true }
      });
    }

    /* 设计原则：容器淡入 + 4 组数据错峰 + 数字真的滚起来 */
    const stats = $('.stats');
    if (stats) {
      stats.classList.add('is-visible');
      gsap.from($$('.stat', stats), {
        autoAlpha: 0,
        y: 24,
        duration: 0.62,
        ease: EASE_OUT,
        stagger: 0.09,
        scrollTrigger: {
          trigger: stats,
          start: 'top 86%',
          once: true,
          onEnter() {
            $$('[data-count]', stats).forEach((el, i) => countUp(el, i * 0.09));
          }
        }
      });
    }

    /* 常见问题：7 条问题逐条滑入，比整块淡入更贴合「一条条读下去」的节奏 */
    const faqList = $('#faqList');
    if (faqList) {
      faqList.classList.add('is-visible');
      gsap.from($$('.acc', faqList), {
        autoAlpha: 0,
        x: 22,
        duration: 0.55,
        ease: EASE_OUT,
        stagger: { each: 0.055 },
        scrollTrigger: { trigger: faqList, start: 'top 86%', once: true }
      });
    }

    /* 结尾号召：整块轻微放大落定，内部元素跟着次第浮出 */
    const ctaInner = $('.cta__inner');
    if (ctaInner) {
      ctaInner.classList.add('is-visible');
      gsap
        .timeline({
          scrollTrigger: { trigger: ctaInner, start: 'top 86%', once: true }
        })
        .from(ctaInner, { scale: 0.975, duration: 0.7, ease: EASE_OUT })
        .from(
          $$('.eyebrow, .cta__title, .cta__sub, .cta__btns .btn, .cta__trust', ctaInner),
          { autoAlpha: 0, y: 18, duration: 0.6, ease: EASE_OUT, stagger: 0.08 },
          '-=0.4'
        );
    }
  }

  /* ==================================================================
     G. FAQ 展开时内容逐段浮出
     main.js 负责开关状态与 aria，这里只在「已经打开」之后补一层内容入场
     ================================================================== */
  function faqContentMotion() {
    document.addEventListener('click', (e) => {
      const q = e.target.closest && e.target.closest('.acc__q');
      if (!q) return;
      const acc = q.closest('.acc');
      if (!acc || !acc.classList.contains('is-open')) return;

      const items = $$('.acc__inner > *', acc);
      if (!items.length) return;
      gsap.fromTo(
        items,
        { autoAlpha: 0, y: 9 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.36,
          ease: EASE_OUT,
          stagger: 0.05,
          delay: 0.05,
          overwrite: true
        }
      );
    });
  }

  /* ==================================================================
     H. 视差：首屏光晕 / 页脚巨型字标
     ================================================================== */
  function parallax() {
    const glow = $('.hero__glow');
    if (glow) {
      gsap.to(glow, {
        yPercent: 16,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero',
          start: 'top top',
          end: 'bottom top',
          scrub: true
        }
      });
    }

    const wordmark = $('.footer__wordmark');
    if (wordmark) {
      gsap.fromTo(
        wordmark,
        { yPercent: 20 },
        {
          yPercent: -8,
          ease: 'none',
          scrollTrigger: {
            trigger: '.footer',
            start: 'top bottom',
            end: 'bottom bottom',
            scrub: 0.6
          }
        }
      );
    }
  }

  /* ==================================================================
     I. 主推方案卡的呼吸光晕
     只推一个 CSS 变量，让 CSS 自己画渐变，省下逐帧重绘
     ================================================================== */
  function halo() {
    const card = $('.plan--featured');
    if (!card) return;
    gsap.fromTo(
      card,
      { '--lingora-halo': 0.35 },
      {
        '--lingora-halo': 1,
        duration: 3.2,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true
      }
    );
  }

  /* ==================================================================
     J. 返回顶部按钮
     ================================================================== */
  function toTopMotion() {
    const btn = $('#toTop');
    if (!btn) return;
    const svg = $('svg', btn);
    if (!svg) return;
    btn.addEventListener('click', () => {
      gsap.fromTo(
        svg,
        { y: 4 },
        { y: -3, duration: 0.22, ease: 'power2.out', yoyo: true, repeat: 1 }
      );
    });
  }

  /* ==================================================================
     K. 组织：断点差异化
     ================================================================== */
  const mm = gsap.matchMedia();

  mm.add(
    {
      wide: '(min-width: 1025px)',
      narrow: '(max-width: 1024px)'
    },
    (ctx) => {
      const { wide } = ctx.conditions;

      /* 滚动入场：同一批元素在宽窄屏用不同的位移幅度，
         窄屏幅度更小，避免在短视口里「从很远的地方飞进来」 */
      if (scrollReveals.length) {
        ScrollTrigger.batch(scrollReveals, {
          start: 'top 88%',
          once: true,
          interval: 0.08,
          batchMax: 6,
          onEnter(batch) {
            batch.forEach((el) => el.classList.add('is-visible'));
            gsap.from(batch, {
              autoAlpha: 0,
              y: wide ? 28 : 18,
              duration: wide ? 0.78 : 0.62,
              ease: EASE_OUT,
              stagger: { each: wide ? 0.075 : 0.06 },
              overwrite: true
            });
          }
        });
      }

      groupedReveals();

      /* 3D 倾斜只在宽屏开启：窄屏是触摸操作，没有 hover 语义 */
      if (wide) {
        bindTilt($$('.card--feature, .card--scene, .card--quote, .plan, .step'));
      }

      return () => {
        /* matchMedia 会自动回收本作用域内创建的补间与 ScrollTrigger，
           这里只处理自己挂上去的类名与行内样式 */
        scrollReveals.forEach((el) => el.classList.add('is-visible'));
      };
    }
  );

  /* 与断点无关的部分，只跑一次 */
  playHero();
  faqContentMotion();
  parallax();
  halo();
  toTopMotion();

  /* ==================================================================
     L. 字体就绪后重算触发位置
     中文标题靠 webfont 渲染，字体落地前后行高会变，位置必须重算一次
     ================================================================== */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });

  /* 调试与手工回收入口 */
  window.lingoraMotion = {
    gsap,
    ScrollTrigger,
    refresh: () => ScrollTrigger.refresh(),
    revert() {
      ScrollTrigger.getAll().forEach((t) => t.kill());
      mm.revert();
      html.classList.remove('has-gsap');
      $$('[data-reveal]').forEach((el) => el.classList.add('is-visible'));
    }
  };
})();
