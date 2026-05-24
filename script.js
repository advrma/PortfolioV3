/* =========================================================
   ADITYA VERMA · PORTFOLIO V3
   Scroll-driven image sequence + micro-interactions
   ========================================================= */

(() => {
  'use strict';

  /* -------------------------------------------------------
     CONFIG: image sequence
     ------------------------------------------------------- */
  // Source has 300 frames. We sample every Nth to keep total
  // payload reasonable while still feeling silky on scroll.
  const TOTAL_SOURCE_FRAMES = 300;
  const STEP = 3;                  // every Nth source frame
  const PAD = 4;                   // filename zero-padding
  const PREFIX = 'CYBERFICTION-IMAGES/male';
  const EXT = '.png';

  // Build list of frame URLs we'll actually load
  const frameUrls = [];
  for (let i = 1; i <= TOTAL_SOURCE_FRAMES; i += STEP) {
    frameUrls.push(`${PREFIX}${String(i).padStart(PAD, '0')}${EXT}`);
  }
  const FRAME_COUNT = frameUrls.length;

  /* -------------------------------------------------------
     SHARED STATE
     ------------------------------------------------------- */
  const images = new Array(FRAME_COUNT);
  let loadedCount = 0;
  let everythingLoaded = false;

  // Single canvas covers the whole pinned stage now. Frame 0
   // is painted on first load; scroll drives the animation.
  const cinemaCanvas = document.getElementById('cinemaCanvas');
  const cinemaCtx = cinemaCanvas.getContext('2d');
  const heroSection = document.getElementById('hero');
  const heroStageUI = document.getElementById('heroStageUI');
  const cinemaOverlay = document.getElementById('cinemaOverlay');
  const heroLoading = document.getElementById('heroLoading');
  const heroLoadingPct = document.getElementById('heroLoadingPct');
  const cinemaFrameNum = document.getElementById('cinemaFrameNum');
  const cinemaBar = document.getElementById('cinemaBar');
  const cinemaRuntime = document.getElementById('cinemaRuntime');
  const captions = Array.from(document.querySelectorAll('.cinema__caption'));
  const topoBg = document.querySelector('.topo-bg');
  const aurora = document.querySelector('.aurora');

  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  /* -------------------------------------------------------
     SCROLL STATE — GSAP ScrollTrigger drives a `frameState`
     object via `scrub`. We render whenever the rounded frame
     changes. Scrub does the cinematic smoothing — no custom
     lerp loop needed.
     ------------------------------------------------------- */
  const frameState = { idx: 0 };
  let mainTrigger = null;

  /* -------------------------------------------------------
     PRELOAD WITH PRIORITY
     - First frame loads first (for hero idle)
     - Last frame next (for snappy first scrub feel)
     - Then everything else in parallel batches
     ------------------------------------------------------- */
  function loadImage(index) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = frameUrls[index];
      img.onload = () => {
        images[index] = img;
        loadedCount++;
        updateLoadingUI();
        resolve(img);
      };
      img.onerror = () => {
        loadedCount++;
        updateLoadingUI();
        resolve(null);
      };
    });
  }

  function updateLoadingUI() {
    const pct = Math.round((loadedCount / FRAME_COUNT) * 100);
    if (heroLoadingPct) heroLoadingPct.textContent = pct;
    const bar = heroLoading?.querySelector('.hero__loading-bar i');
    if (bar) bar.style.width = pct + '%';

    if (loadedCount >= FRAME_COUNT && !everythingLoaded) {
      everythingLoaded = true;
      heroLoading?.classList.add('is-done');
      setTimeout(() => heroLoading?.remove(), 900);
    }
  }

  async function preloadAll() {
    // Critical first — paint hero immediately when frame 0 is in.
    await loadImage(0);
    renderFrame(0);

    await loadImage(FRAME_COUNT - 1);

    // The rest in parallel but capped to avoid bandwidth thrashing
    const remaining = [];
    for (let i = 1; i < FRAME_COUNT - 1; i++) remaining.push(i);

    const CONCURRENCY = 8;
    let cursor = 0;
    const workers = new Array(CONCURRENCY).fill(0).map(async () => {
      while (cursor < remaining.length) {
        const idx = remaining[cursor++];
        await loadImage(idx);
      }
    });
    await Promise.all(workers);
  }

  /* -------------------------------------------------------
     CANVAS SIZING
     - Set internal resolution to match displayed size × dpr
     ------------------------------------------------------- */
  function sizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, rectW: rect.width, rectH: rect.height };
  }

  /* -------------------------------------------------------
     DRAW: contain image inside canvas. `xCrop` narrows the
     source horizontally to zoom past the empty padding around
     the character; the full character (head → bottom edge)
     stays visible because we scale by `min`, never `max`.
     ------------------------------------------------------- */
  function drawImageContain(ctx, canvas, img, xCrop = 1) {
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (!img) return;

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;

    // Crop the source horizontally to the character bounding
    // area (keeps full height — head to bottom of shoulders).
    const sw = iw * xCrop;
    const sh = ih;
    const sx = (iw - sw) / 2;
    const sy = 0;

    // Contain: take the smaller axis ratio so nothing overflows.
    const scale = Math.min(cw / sw, ch / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /* -------------------------------------------------------
     PROGRESS HELPERS / DRAW SUPPORT
     ------------------------------------------------------- */
  let lastDrawnFrame = -1;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* Phase mapping inside the pinned stage:
       0.00 → 1.00   Character animation runs across the FULL
                     scroll range — first scroll pixel already
                     advances the frame.
       0.00 → 0.15   UI fades + translates out in parallel.
     Returns { uiP, animP } both clamped to 0–1. */
  const UI_EXIT_END = 0.15;
  function splitProgress(p) {
    const uiP = clamp01(p / UI_EXIT_END);
    const animP = clamp01(p);
    return { uiP, animP };
  }

  function nearestLoaded(idx) {
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (images[idx - d]) return images[idx - d];
      if (images[idx + d]) return images[idx + d];
    }
    return images[0] || null;
  }

  /* Draw a single frame into the canvas with contain-fit so the
     entire character (head, shoulders, torso, bottom edge) is
     always visible. xCrop = 0.6 means we only ignore the
     outer 20% of the source on each side (the transparent
     gutters that have NO character pixels on any frame), which
     keeps the character from looking tiny while guaranteeing
     no part of the character — including swaying hair on
     mid-animation frames — is ever clipped. */
  function renderFrame(idx) {
    const i = idx | 0;
    if (i === lastDrawnFrame) return;
    const img = images[i] || nearestLoaded(i);
    drawImageContain(cinemaCtx, cinemaCanvas, img, 0.6);
    lastDrawnFrame = i;
  }

  /* HUD/captions read from the character-animation progress
     (everything after the UI has scrolled away). */
  function renderCinemaUI(animP) {
    const cp = clamp01(animP);
    const sourceFrameNumber = Math.round(cp * (TOTAL_SOURCE_FRAMES - 1)) + 1;
    if (cinemaFrameNum) {
      cinemaFrameNum.textContent = `${String(sourceFrameNumber).padStart(3, '0')} / 300`;
    }
    if (cinemaBar) {
      cinemaBar.style.width = (cp * 100).toFixed(1) + '%';
    }
    if (cinemaRuntime) {
      const totalSeconds = 12;
      const t = cp * totalSeconds;
      const mm = Math.floor(t / 60).toString().padStart(2, '0');
      const ss = Math.floor(t % 60).toString().padStart(2, '0');
      cinemaRuntime.textContent = `${mm}:${ss}`;
    }
    captions.forEach((c) => {
      const from = parseFloat(c.dataset.from);
      const to = parseFloat(c.dataset.to);
      c.classList.toggle('is-active', cp >= from && cp < to);
    });
  }

  /* -------------------------------------------------------
     SCROLL-DRIVEN CHARACTER X MOVEMENT
     - The scroll progress (0–1 through the pinned hero) is
       mapped to a virtual frame counter 0–270.
     - The character canvas translates left/right across the
       viewport at scripted frame ranges with an ease-out curve.
     - The output is written to the same `--char-x-scroll` CSS
       variable that the canvas's transform composes with the
       cursor channel — so cursor parallax and scroll movement
       stack cleanly without overwriting each other.
     - Respects prefers-reduced-motion (returns 0 always).
     ------------------------------------------------------- */
  const TOTAL_VIRTUAL_FRAMES = 270;
  const reduceMotionMQ = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  /* Three cubic eases — used selectively per segment so the
     character can keep velocity through the center handoff
     between frames 167 and 168 (no slowdown there). */
  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeInCubic(t)  { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function rangeProgress(frame, start, end) {
    return clamp01((frame - start) / (end - start));
  }
  function lerpVal(a, b, t) { return a + (b - a) * t; }

  /* Maximum horizontal shift. Scales with viewport, but capped
     so the character never gets cropped on narrow screens —
     we never push the canvas wider than its available side
     space + the empty source-padding margin inside it. */
  function getScrollShift() {
    const vw = window.innerWidth;
    const canvasW = cinemaCanvas.getBoundingClientRect().width;
    const sideRoom = Math.max(0, (vw - canvasW) / 2);
    // 22vw default, capped so the visible character body stays
    // inside the viewport (side room + ~10% of the canvas-width
    // worth of source padding around the character).
    return Math.min(vw * 0.22, sideRoom + canvasW * 0.10);
  }

  function computeScrollX(progress) {
    if (reduceMotionMQ && reduceMotionMQ.matches) return 0;

    const frame = progress * TOTAL_VIRTUAL_FRAMES;
    const SHIFT = getScrollShift();
    const LEFT_X  = -SHIFT;
    const RIGHT_X =  SHIFT;

    // Frames 0–76: hold center
    if (frame <= 76) return 0;
    // 77–127: center → left (slow → fast → slow)
    if (frame <= 127) {
      return lerpVal(0, LEFT_X, easeInOutCubic(rangeProgress(frame, 77, 127)));
    }
    // 128–155: left → center. easeIn so the curve is slow at
    // the start but does NOT slow down at the end — velocity
    // is at its peak when it hits frame 155, ready to hand off.
    if (frame <= 155) {
      return lerpVal(LEFT_X, 0, easeInCubic(rangeProgress(frame, 128, 155)));
    }
    // 156–185: center → right. easeOut so it picks up at full
    // speed (no slow start) matching the end of the previous
    // segment, then decelerates into the right pose.
    if (frame <= 185) {
      return lerpVal(0, RIGHT_X, easeOutCubic(rangeProgress(frame, 156, 185)));
    }
    // 186–199: hold on the right side
    if (frame < 200) return RIGHT_X;
    // 200–250: right → center (slow start, fast end)
    if (frame <= 250) {
      return lerpVal(RIGHT_X, 0, easeInCubic(rangeProgress(frame, 200, 250)));
    }
    // After frame 250 — hold center.
    return 0;
  }

  /* -------------------------------------------------------
     GSAP ScrollTrigger setup — one main scrubbed trigger
     covers the entire pinned hero-stage and drives three
     things from a single source of truth:
       1. UI layer: translateY -100%  + fade as it leaves
       2. Character canvas: frame 0 → last (only after UI exit)
       3. Cinema HUD overlay: fades in once UI is gone
     Background parallax is a separate trigger that covers
     the whole document so the topo + aurora keep gliding
     past the hero stage.
     ------------------------------------------------------- */
  function initScrollTriggers() {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
      // Fallback for when GSAP fails to load — direct scroll
      // listener with no smoothing, basic behavior preserved.
      const fallback = () => {
        const sy = window.scrollY;
        const range = heroSection.offsetHeight - window.innerHeight;
        const p = clamp01(sy / range);
        const { uiP, animP } = splitProgress(p);
        if (heroStageUI) {
          heroStageUI.style.transform = `translate3d(0, ${-uiP * 110}%, 0)`;
          heroStageUI.style.opacity = String(1 - uiP);
        }
        if (cinemaOverlay) cinemaOverlay.style.opacity = String(uiP);
        renderFrame(Math.round(animP * (FRAME_COUNT - 1)));
        renderCinemaUI(animP);
        cinemaCanvas.style.setProperty(
          '--char-x-scroll', `${computeScrollX(p).toFixed(2)}px`
        );
      };
      window.addEventListener('scroll', fallback, { passive: true });
      fallback();
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    // Main pinned-stage scrub. `scrub: 1.1` gives a ~1.1s
    // catch-up so the canvas + UI exit have GPU-smooth inertia
    // after the user stops scrolling.
    gsap.to(frameState, {
      idx: FRAME_COUNT - 1,
      ease: 'none',
      scrollTrigger: {
        trigger: heroSection,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1.1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const { uiP, animP } = splitProgress(self.progress);

          // 1. UI scrolls up + fades — transform/opacity only.
          if (heroStageUI) {
            heroStageUI.style.transform =
              `translate3d(0, ${(-uiP * 110).toFixed(2)}%, 0)`;
            heroStageUI.style.opacity = (1 - uiP).toFixed(3);
          }

          // 2. Cinema HUD fades in opposite the UI exit.
          if (cinemaOverlay) {
            cinemaOverlay.style.opacity = uiP.toFixed(3);
          }

          // 3. Character animation only starts after UI is gone.
          //    Until then we hold frame 0 (the natural idle pose).
          const frame = Math.round(animP * (FRAME_COUNT - 1));
          renderFrame(frame);
          renderCinemaUI(animP);

          // 4. Frame-scripted X drift of the canvas DOM. Writes
          //    to a CSS variable so the cursor parallax channel
          //    (which writes a different variable) keeps working
          //    in parallel — the canvas's transform composes
          //    both with calc(-50% + cursor + scroll).
          const scrollX = computeScrollX(self.progress);
          cinemaCanvas.style.setProperty(
            '--char-x-scroll', `${scrollX.toFixed(2)}px`
          );
        }
      }
    });

    // Background parallax — covers the full document so topo
    // and aurora keep drifting in the sections after hero.
    if (topoBg) {
      gsap.to(topoBg, {
        yPercent: -8,
        ease: 'none',
        scrollTrigger: {
          trigger: document.body,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1.4,
          invalidateOnRefresh: true
        }
      });
    }
    if (aurora) {
      gsap.to(aurora, {
        yPercent: 5,
        ease: 'none',
        scrollTrigger: {
          trigger: document.body,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1.4,
          invalidateOnRefresh: true
        }
      });
    }
  }

  /* -------------------------------------------------------
     RESIZE — re-fit canvases and let ScrollTrigger recompute.
     ScrollTrigger already debounces a refresh on viewport
     resize, but `refresh()` runs immediately for snappy feel.
     ------------------------------------------------------- */
  let resizeTimeout;
  function onResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeCanvas(cinemaCanvas);
      lastDrawnFrame = -1;
      if (typeof ScrollTrigger !== 'undefined') {
        ScrollTrigger.refresh();
      } else {
        renderFrame(Math.round(frameState.idx));
      }
    }, 120);
  }

  /* -------------------------------------------------------
     SCROLL REVEALS (IntersectionObserver)
     ------------------------------------------------------- */
  function initReveals() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in-view'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -60px 0px' });
    els.forEach((el) => io.observe(el));
  }

  /* Hero entrance now CSS-driven; no JS needed here */

  /* -------------------------------------------------------
     STAT NUMBER COUNTERS
     ------------------------------------------------------- */
  function formatNumber(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 1 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'K';
    return String(n);
  }
  function animateNumber(el, to, suffix, durationMs = 1800) {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.floor(eased * to);
      el.textContent = formatNumber(v) + (suffix || '');
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = formatNumber(to) + (suffix || '');
    }
    requestAnimationFrame(step);
  }
  function initStatCounters() {
    const nums = document.querySelectorAll('.stat-num');
    if (!('IntersectionObserver' in window)) {
      nums.forEach((el) => {
        animateNumber(el, parseInt(el.dataset.to, 10), el.dataset.suffix || '');
      });
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const card = el.closest('.stat-card');
        if (card) card.classList.add('in-view');
        animateNumber(el, parseInt(el.dataset.to, 10), el.dataset.suffix || '');
        io.unobserve(el);
      });
    }, { threshold: 0.4 });
    nums.forEach((el) => io.observe(el));
  }

  /* -------------------------------------------------------
     SCROLL PROGRESS BAR (top)
     ------------------------------------------------------- */
  function initScrollProgress() {
    const bar = document.querySelector('.scroll-progress span');
    if (!bar) return;
    function update() {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const p = h > 0 ? window.scrollY / h : 0;
      bar.style.width = (p * 100).toFixed(2) + '%';
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }

  /* -------------------------------------------------------
     CURSOR PARALLAX (Lando-style depth effect).
     - Cursor → character translates OPPOSITE on X (creates a
       sense the character is "behind" the cursor plane).
     - Cursor → character translates SAME direction on Y (the
       character tracks vertical cursor movement like a head
       following).
     - Small rotateX / rotateY enhance the depth illusion.
     - All values lerp-smoothed per rAF, with the loop self-
       suspending when the cursor has left and motion has
       settled — zero CPU at rest.
     - Composes with the canvas's `translateX(-50%)` centering
       via `calc(-50% + Npx)`; the scroll-driven canvas
       redraw is on a separate channel and is unaffected.
     - prefers-reduced-motion + touch pointers → no-op. */
  function initCursorParallax() {
    const canvas = document.getElementById('cinemaCanvas');
    const pin = document.querySelector('.hero-stage__pin');
    if (!canvas || !pin) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Distance-adaptive lerp — fast initial catch-up that drops
    // sharply into a very slow crawl once the gap is small.
    //   |delta| ≥ ~10  →  step ≈ 22% of delta (snappy)
    //   |delta| ~  3   →  step ≈ 14% of delta
    //   |delta| ~  1   →  step ≈  8% of delta
    //   |delta| <  0.5 →  step ≈  4% of delta (drift)
    // The exponential blend gives a smooth "lunges then drifts"
    // curve and naturally creates a perceptible delay before the
    // character finishes settling after the cursor stops moving.
    const MAX_TX = 12;      // ±12px, opposite cursor (X only)
    const LERP_FAST = 0.22;
    const LERP_SLOW = 0.04;
    const LERP_K = 0.30;    // larger = sharper fast→slow transition
    const SETTLE_PX = 0.3;  // snap-exit threshold (visually imperceptible)

    let targetTx = 0;
    let renderedTx = 0;
    let active = false;
    let running = false;

    // Sigmoid-like blend between SLOW and FAST based on |delta|.
    function lerpForDelta(d) {
      const m = Math.abs(d);
      const t = 1 - Math.exp(-m * LERP_K);   // 0 at m=0, →1 as m grows
      return LERP_SLOW + (LERP_FAST - LERP_SLOW) * t;
    }

    function tick() {
      const dx = targetTx - renderedTx;
      renderedTx += dx * lerpForDelta(dx);

      // Write the cursor channel only; the canvas's CSS rule
      // composes this with the scroll-driven X channel via calc().
      canvas.style.setProperty('--char-x-cursor', `${renderedTx.toFixed(2)}px`);

      if (Math.abs(targetTx - renderedTx) < SETTLE_PX) {
        // Snap and suspend. Keep the value applied if the cursor
        // is still over the pin; otherwise drop back to the
        // default 0 (CSS variable's initial value).
        renderedTx = targetTx;
        if (!active) {
          canvas.style.setProperty('--char-x-cursor', '0px');
        } else {
          canvas.style.setProperty('--char-x-cursor', `${targetTx.toFixed(2)}px`);
        }
        running = false;
        return;
      }
      requestAnimationFrame(tick);
    }

    function start() {
      if (running) return;
      running = true;
      requestAnimationFrame(tick);
    }

    pin.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const rect = pin.getBoundingClientRect();
      const halfW = rect.width / 2;
      // Normalize horizontal cursor position to [-1, 1].
      const nx = (e.clientX - rect.left - halfW) / halfW;
      // X only — opposite cursor (parallax depth).
      targetTx = -nx * MAX_TX;

      active = true;
      start();
    }, { passive: true });

    pin.addEventListener('pointerleave', () => {
      targetTx = 0;
      active = false;
      start();
    }, { passive: true });
  }

  /* -------------------------------------------------------
     INIT
     ------------------------------------------------------- */
  function init() {
    // Initial canvas sizing right away so first frame fills.
    sizeCanvas(cinemaCanvas);

    // Static-capture mode: ?ss=1 forces everything visible immediately
    const params = new URLSearchParams(location.search);
    if (params.has('ss')) {
      document.querySelectorAll('.reveal, .reveal-stagger, .stat-card')
        .forEach((el) => el.classList.add('in-view', 'is-shown'));
      document.querySelectorAll('.stat-num').forEach((el) => {
        el.textContent = (() => {
          const n = parseInt(el.dataset.to, 10);
          if (n >= 1_000_000) return (n / 1_000_000) + 'M';
          if (n >= 1_000) return (n / 1_000) + 'K';
          return n;
        })() + (el.dataset.suffix || '');
      });
    }
    if (params.has('scroll')) {
      const y = parseInt(params.get('scroll'), 10);
      const doScroll = () => {
        window.scrollTo(0, y);
        document.documentElement.scrollTop = y;
        document.body.scrollTop = y;
      };
      doScroll();
      setTimeout(doScroll, 100);
      setTimeout(doScroll, 500);
      setTimeout(doScroll, 1500);
    }

    initReveals();
    initStatCounters();
    initScrollProgress();
    initCursorParallax();

    // Wire up GSAP ScrollTriggers BEFORE we start preloading so
    // the very first scroll already gets the smooth scrub.
    initScrollTriggers();

    // Paint frame 0 right away so the hero never looks empty.
    renderFrame(0);

    // Preload frames in priority order. When the full set is in
    // memory, force a redraw and tell ScrollTrigger to recompute
    // start/end (in case image-driven layout shifted anything).
    preloadAll().then(() => {
      lastDrawnFrame = -1;
      renderFrame(Math.round(frameState.idx));
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
    });

    window.addEventListener('resize', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
