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

  /* -------------------------------------------------------
     CHARACTER SPRING LAYER — adds an extra inertia pass on
     top of GSAP's scrub. The scroll progress only updates a
     target value; a self-suspending rAF loop runs spring
     physics so the character (image frame + X movement + HUD)
     keeps coasting briefly after the user stops scrolling and
     settles smoothly. Critically, the UI scroll-away is NOT
     spring-smoothed — that channel stays instantly responsive
     so the page never feels laggy under the cursor.
     ------------------------------------------------------- */
  let targetProgress = 0;
  let currentProgress = 0;
  let springVelocity = 0;
  let springRunning = false;
  const SPRING_K       = 0.035;   // pull toward target
  const SPRING_DAMP    = 0.82;    // velocity decay per frame
  const SPRING_SETTLE  = 0.0005;  // |diff| & |vel| < this → exit

  /* Apply the smoothed progress to everything character-related:
     the canvas frame, HUD counters/captions, and the scroll-X
     CSS variable that combines with the cursor channels. */
  function applyCharacter(progress) {
    const { animP } = splitProgress(progress);
    renderFrame(Math.round(animP * (FRAME_COUNT - 1)));
    renderCinemaUI(animP);
    cinemaCanvas.style.setProperty(
      '--char-x-scroll', `${computeScrollX(progress).toFixed(2)}px`
    );
  }

  function springTick() {
    const diff = targetProgress - currentProgress;
    springVelocity += diff * SPRING_K;
    springVelocity *= SPRING_DAMP;
    currentProgress += springVelocity;

    applyCharacter(currentProgress);

    if (Math.abs(diff) < SPRING_SETTLE &&
        Math.abs(springVelocity) < SPRING_SETTLE) {
      // Truly settled — snap exactly to target and suspend.
      currentProgress = targetProgress;
      springVelocity = 0;
      applyCharacter(currentProgress);
      springRunning = false;
      return;
    }
    requestAnimationFrame(springTick);
  }

  /* Kick the spring loop. Called by every scroll update; the
     loop self-arms only when it's not already running. Reduced
     motion bypasses the spring entirely (snap to target). */
  function springKick() {
    if (reduceMotionMQ && reduceMotionMQ.matches) {
      currentProgress = targetProgress;
      springVelocity = 0;
      applyCharacter(currentProgress);
      return;
    }
    if (springRunning) return;
    springRunning = true;
    requestAnimationFrame(springTick);
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
        const { uiP } = splitProgress(p);
        if (heroStageUI) {
          heroStageUI.style.transform = `translate3d(0, ${-uiP * 110}%, 0)`;
          heroStageUI.style.opacity = String(1 - uiP);
        }
        if (cinemaOverlay) cinemaOverlay.style.opacity = String(uiP);
        // Route character work through the same spring layer so
        // the inertia tail still applies even without GSAP.
        targetProgress = p;
        springKick();
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
          const { uiP } = splitProgress(self.progress);

          // 1. UI scrolls up + fades — INSTANT (no spring) so
          //    the page feels responsive under the cursor.
          if (heroStageUI) {
            heroStageUI.style.transform =
              `translate3d(0, ${(-uiP * 110).toFixed(2)}%, 0)`;
            heroStageUI.style.opacity = (1 - uiP).toFixed(3);
          }

          // 2. Cinema HUD fades in opposite the UI exit.
          if (cinemaOverlay) {
            cinemaOverlay.style.opacity = uiP.toFixed(3);
          }

          // 3. Everything character-related — frame swap, HUD
          //    detail, and X drift — is routed through the
          //    spring layer. The scroll value only updates the
          //    target; an rAF loop chases it with inertia and
          //    continues coasting briefly after scroll stops.
          targetProgress = self.progress;
          springKick();
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
    const MAX_TX = 12;      // ±12px, opposite cursor
    const MAX_TY = 4;       // ±4px, opposite cursor — barely noticeable
    const LERP_FAST = 0.22;
    const LERP_SLOW = 0.04;
    const LERP_K = 0.30;    // larger = sharper fast→slow transition
    const SETTLE_PX = 0.3;  // snap-exit threshold (visually imperceptible)

    let targetTx = 0, targetTy = 0;
    let renderedTx = 0, renderedTy = 0;
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
      const dy = targetTy - renderedTy;
      renderedTx += dx * lerpForDelta(dx);
      renderedTy += dy * lerpForDelta(dy);

      // Write the cursor channels only; the canvas's CSS rule
      // composes these with the scroll-driven X channel via calc().
      canvas.style.setProperty('--char-x-cursor', `${renderedTx.toFixed(2)}px`);
      canvas.style.setProperty('--char-y-cursor', `${renderedTy.toFixed(2)}px`);

      const settled =
        Math.abs(targetTx - renderedTx) < SETTLE_PX &&
        Math.abs(targetTy - renderedTy) < SETTLE_PX;

      if (settled) {
        // Snap and suspend. Keep the value applied if the cursor
        // is still over the pin; otherwise drop back to 0.
        renderedTx = targetTx;
        renderedTy = targetTy;
        if (!active) {
          canvas.style.setProperty('--char-x-cursor', '0px');
          canvas.style.setProperty('--char-y-cursor', '0px');
        } else {
          canvas.style.setProperty('--char-x-cursor', `${targetTx.toFixed(2)}px`);
          canvas.style.setProperty('--char-y-cursor', `${targetTy.toFixed(2)}px`);
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
      const halfH = rect.height / 2;
      // Normalize cursor position to [-1, 1] from pin center.
      const nx = (e.clientX - rect.left - halfW) / halfW;
      const ny = (e.clientY - rect.top  - halfH) / halfH;
      // Both axes move opposite to the cursor for the parallax
      // depth read. Y magnitude is intentionally tiny so the
      // vertical drift is barely perceptible.
      targetTx = -nx * MAX_TX;
      targetTy = -ny * MAX_TY;

      active = true;
      start();
    }, { passive: true });

    pin.addEventListener('pointerleave', () => {
      targetTx = 0;
      targetTy = 0;
      active = false;
      start();
    }, { passive: true });
  }

  /* -------------------------------------------------------
     SKILLS HYPER-SCROLL — pinned 3D camera flythrough.
     - 5 category headings (big stroke text) interleaved with
       3 skill cards each, plus drifting starfield particles.
     - cameraZ is driven by the section's scroll progress
       (ScrollTrigger.scrub: 0.6) so the world flies past the
       viewer as they scroll through the pinned runway.
     - Camera tilts subtly with cursor; scroll velocity bends
       the perspective (warp feel) and stretches stars.
     - rAF render loop self-suspends when the section is not
       in view to avoid burning frames on hidden 3D.
     ------------------------------------------------------- */
  function initSkillsWarp() {
    const section  = document.getElementById('skills');
    const viewport = document.getElementById('warpViewport');
    const world    = document.getElementById('warpWorld');
    const velEl    = document.getElementById('warpVel');
    const coordEl  = document.getElementById('warpCoord');
    const catEl    = document.getElementById('warpCat');
    if (!section || !viewport || !world) return;

    /* Heading + the top skills per category. Order is the
       sequence the camera flies past, then loops. */
    const SKILLS = [
      { type: 'heading', text: 'LANGUAGES', cat: '01' },
      { type: 'card',  cat: '01', name: 'TypeScript',  sub: 'Daily driver across the stack.',          meta: 'TYPED · NEXT.JS' },
      { type: 'card',  cat: '01', name: 'Python',       sub: 'ML pipelines, scrapers, scripts.',       meta: 'ML · DATA' },
      { type: 'card',  cat: '01', name: 'Java',         sub: 'Production backend services.',           meta: 'REST · JVM' },
      { type: 'card',  cat: '01', name: 'C / C++',      sub: 'SimX VR physics, low-level work.',       meta: 'NATIVE' },
      { type: 'card',  cat: '01', name: 'SQL',          sub: 'Postgres, joins, query tuning.',         meta: 'QUERY' },
      { type: 'card',  cat: '01', name: 'JavaScript',   sub: 'Modern ES, async, DOM craft.',           meta: 'WEB · NODE' },

      { type: 'heading', text: 'FRAMEWORKS', cat: '02' },
      { type: 'card',  cat: '02', name: 'Next.js 15',   sub: 'App router, RSC, edge runtimes.',        meta: 'REACT · RSC' },
      { type: 'card',  cat: '02', name: 'React',        sub: 'Components, hooks, suspense.',           meta: '5 YRS' },
      { type: 'card',  cat: '02', name: 'Convex',       sub: 'Real-time backend + sync.',              meta: 'LIVE · SYNC' },
      { type: 'card',  cat: '02', name: 'Tailwind CSS', sub: 'Design tokens at the source.',           meta: 'UTILITY' },
      { type: 'card',  cat: '02', name: 'Framer Motion',sub: 'Spring physics for UI.',                 meta: 'ANIM' },
      { type: 'card',  cat: '02', name: 'Supabase',     sub: 'Auth + Postgres at the edge.',           meta: 'BAAS' },
      { type: 'card',  cat: '02', name: 'Playwright',   sub: 'Scrape, test, automate.',                meta: 'E2E' },

      { type: 'heading', text: 'AI / ML', cat: '03' },
      { type: 'card',  cat: '03', name: 'LLMs / RAG',   sub: 'Semantic search, scoring, tools.',       meta: 'EMBEDDING' },
      { type: 'card',  cat: '03', name: 'OpenAI API',   sub: 'Streaming, tool use, citations.',        meta: 'STREAM' },
      { type: 'card',  cat: '03', name: 'PyTorch',      sub: 'Custom training + inference.',           meta: 'TORCH' },
      { type: 'card',  cat: '03', name: 'TensorFlow',   sub: 'Production model pipelines.',            meta: 'KERAS' },
      { type: 'card',  cat: '03', name: 'ML Pipelines', sub: 'Ingest → score → ship.',                 meta: 'ETL' },
      { type: 'card',  cat: '03', name: 'Model Infer',  sub: 'Low-latency serving.',                   meta: 'INFER' },

      { type: 'heading', text: 'CLOUD', cat: '04' },
      { type: 'card',  cat: '04', name: 'AWS',          sub: 'EC2 · S3 · Lambda · IAM.',               meta: 'PROD' },
      { type: 'card',  cat: '04', name: 'Docker',       sub: 'Container ship to anywhere.',            meta: 'OCI' },
      { type: 'card',  cat: '04', name: 'CI / CD',      sub: 'GitHub Actions pipelines.',              meta: 'GREEN' },
      { type: 'card',  cat: '04', name: 'Lambda',       sub: 'Serverless event workers.',              meta: 'FAAS' },
      { type: 'card',  cat: '04', name: 'S3',           sub: 'Object storage at scale.',               meta: 'BUCKET' },
      { type: 'card',  cat: '04', name: 'IAM',          sub: 'Least-privilege roles, scoped.',         meta: 'POLICY' },

      { type: 'heading', text: 'CRAFT', cat: '05' },
      { type: 'card',  cat: '05', name: 'UI / UX',      sub: 'Pixel-precise interfaces.',              meta: 'FIGMA' },
      { type: 'card',  cat: '05', name: 'Blender',      sub: '15K+ subs on 3D animation.',             meta: '3D' },
      { type: 'card',  cat: '05', name: 'Adobe CC',     sub: '50+ motion graphics shipped.',           meta: 'MOTION' },
      { type: 'card',  cat: '05', name: 'Unreal Engine',sub: 'Cinematic real-time scenes.',            meta: 'UE5' },
      { type: 'card',  cat: '05', name: 'Unity',        sub: 'VR training environments.',              meta: 'XR' },
      { type: 'card',  cat: '05', name: 'Motion',       sub: 'Springs, eases, scroll.',                meta: 'GSAP' }
    ];

    const Z_GAP       = 800;
    const STAR_COUNT  = 520;
    const TOTAL_Z     = SKILLS.length * Z_GAP;
    const CAMERA_END  = TOTAL_Z;     // one pass — no loop
    const items = [];
    const headingIndices = [];

    // Build DOM
    SKILLS.forEach((data, i) => {
      const el = document.createElement('div');
      el.className = 'warp-item';
      let item;
      if (data.type === 'heading') {
        headingIndices.push(i);
        const h = document.createElement('div');
        h.className = 'warp-heading';
        h.textContent = data.text;
        el.appendChild(h);
        item = { el, type: 'heading', x: 0, y: 0, rot: 0, baseZ: -i * Z_GAP };
      } else {
        const card = document.createElement('article');
        card.className = 'warp-card';
        card.innerHTML =
          '<header class="warp-card__head">' +
            '<span class="warp-card__cat">CAT-' + data.cat + '</span>' +
            '<span class="warp-card__dot"></span>' +
          '</header>' +
          '<div>' +
            '<h3>' + data.name + '</h3>' +
            '<p class="warp-card__sub">' + data.sub + '</p>' +
          '</div>' +
          '<footer class="warp-card__meta">' +
            '<span>' + data.meta + '</span>' +
            '<span>' + String(i).padStart(2, '0') + '/' + String(SKILLS.length - 1).padStart(2, '0') + '</span>' +
          '</footer>' +
          '<span class="warp-card__num">' + String(i).padStart(2, '0') + '</span>';
        el.appendChild(card);

        // Spiral the cards through 3D space so they orbit the headings.
        const angle = (i / SKILLS.length) * Math.PI * 6;
        const x = Math.cos(angle) * (window.innerWidth  * 0.28);
        const y = Math.sin(angle) * (window.innerHeight * 0.28);
        const rot = (i * 47 % 30) - 15;   // deterministic small rotation
        item = { el, type: 'card', x, y, rot, baseZ: -i * Z_GAP };
      }
      items.push(item);
      world.appendChild(el);
    });

    /* Starfield — denser, varied sizes & brightness, plus a
       sprinkle of chartreuse accent stars for atmosphere.
       All visual properties are set once at creation; the
       per-frame render loop only touches transform/opacity
       so the bigger field doesn't cost extra per-frame CPU. */
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      const el = document.createElement('div');
      el.className = 'warp-star';

      const size      = 1 + rnd() * 2.4;          // 1 – 3.4 px
      const baseAlpha = 0.40 + rnd() * 0.55;      // 0.40 – 0.95 (brighter than before)
      const isAccent  = rnd() < 0.10;             // ~10% chartreuse

      el.style.width  = size.toFixed(2) + 'px';
      el.style.height = size.toFixed(2) + 'px';
      if (isAccent) {
        el.style.background = 'rgba(216, 255, 56, ' + baseAlpha.toFixed(2) + ')';
        el.style.boxShadow  = '0 0 6px rgba(216, 255, 56, 0.55)';
      } else {
        el.style.background = 'rgba(242, 238, 229, ' + baseAlpha.toFixed(2) + ')';
        if (size > 2.2) {
          el.style.boxShadow = '0 0 4px rgba(242, 238, 229, 0.40)';
        }
      }

      world.appendChild(el);
      items.push({
        el, type: 'star',
        x: (rnd() - 0.5) * 3800,                  // wider spread for depth
        y: (rnd() - 0.5) * 3800,
        baseZ: -rnd() * TOTAL_Z
      });
    }

    // Local state — refs only
    const state = {
      cameraZ: 0,
      velocity: 0,
      targetVel: 0,
      mouseX: 0,
      mouseY: 0,
      visible: false,
      running: false
    };

    const reduceMotion = reduceMotionMQ && reduceMotionMQ.matches;

    // Drive cameraZ from section scroll progress. `scrub: 1.6`
    // gives the heavy "Lenis-bouncy" feel — scroll inputs land
    // softly and the world keeps coasting briefly after the
    // user stops. Camera travels CAMERA_END (multiple loops)
    // so items keep cycling past forever via the modulo wrap.
    if (typeof ScrollTrigger !== 'undefined' && !reduceMotion) {
      gsap.to(state, {
        cameraZ: CAMERA_END,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1.6,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            state.targetVel = self.getVelocity();
            startRender();
          },
          onEnter:     () => { state.visible = true;  startRender(); },
          onEnterBack: () => { state.visible = true;  startRender(); },
          onLeave:     () => { state.visible = false; },
          onLeaveBack: () => { state.visible = false; }
        }
      });
    } else {
      // Fallback: position items at static spiral, no camera motion.
      state.visible = false;
      items.forEach((item) => {
        if (item.type === 'star') {
          item.el.style.opacity = '0.4';
          item.el.style.transform =
            `translate3d(${item.x}px, ${item.y}px, ${item.baseZ}px)`;
        } else {
          item.el.style.opacity = '1';
          item.el.style.transform =
            `translate3d(${item.x}px, ${item.y}px, ${item.baseZ + TOTAL_Z * 0.5}px)` +
            (item.rot ? ` rotateZ(${item.rot}deg)` : '');
        }
      });
    }

    // Cursor tilt on the world (separate from the canvas cursor parallax)
    section.addEventListener('mousemove', (e) => {
      state.mouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
      state.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    function startRender() {
      if (state.running) return;
      state.running = true;
      requestAnimationFrame(render);
    }

    let lastCameraZ = -1;
    let lastTilt = '';

    function render(time) {
      // Smooth velocity toward target
      state.velocity += (state.targetVel * 0.001 - state.velocity) * 0.10;

      // Suspend when section is offscreen AND nothing is animating.
      const nearlyStill = Math.abs(state.targetVel) < 1
                       && Math.abs(state.velocity)  < 0.01;
      if (!state.visible && nearlyStill) {
        state.running = false;
        return;
      }

      // World tilt (mouse + scroll shake)
      const tiltX = state.mouseY *  4 - state.velocity * 0.3;
      const tiltY = state.mouseX *  4;
      const tiltKey = tiltX.toFixed(2) + '_' + tiltY.toFixed(2);
      if (tiltKey !== lastTilt) {
        world.style.transform = `rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
        lastTilt = tiltKey;
      }

      // Dynamic perspective — closer FOV when scrolling fast (warp feel)
      const fov = 1000 - Math.min(Math.abs(state.velocity) * 6, 450);
      viewport.style.perspective = `${fov.toFixed(0)}px`;

      // HUD
      if (velEl)   velEl.textContent   = Math.abs(state.velocity).toFixed(2);
      if (coordEl) coordEl.textContent = Math.abs(state.cameraZ).toFixed(0).padStart(6, '0');
      if (catEl) {
        // current heading index based on cameraZ (no loop)
        const clampedZ = Math.max(0, Math.min(state.cameraZ, TOTAL_Z));
        let active = 0;
        for (let h = 0; h < headingIndices.length; h++) {
          if (clampedZ >= headingIndices[h] * Z_GAP - Z_GAP * 0.5) active = h;
        }
        catEl.textContent =
          String(active + 1).padStart(2, '0') + ' / ' +
          String(headingIndices.length).padStart(2, '0');
      }

      // Item transforms — single pass through the world.
      const t = time * 0.001;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const vizZ = item.baseZ + state.cameraZ;

        // Opacity envelope: fade in from far, hold, fade out when past camera.
        // Stars use full element opacity so their per-star baseAlpha
        // (set inline at creation) is what controls visible brightness.
        let alpha;
        if (vizZ < -3200)      alpha = 0;
        else if (vizZ < -2200) alpha = (vizZ + 3200) / 1000;
        else if (vizZ > 80 && item.type !== 'star') alpha = Math.max(0, 1 - (vizZ - 80) / 380);
        else                   alpha = 1;

        if (alpha < 0) alpha = 0;
        item.el.style.opacity = alpha.toFixed(3);

        if (alpha > 0) {
          let trans = `translate3d(${item.x}px, ${item.y}px, ${vizZ.toFixed(1)}px)`;
          if (item.type === 'star') {
            const stretch = Math.max(1, Math.min(1 + Math.abs(state.velocity) * 0.06, 8));
            trans += ` scale3d(1, 1, ${stretch.toFixed(2)})`;
          } else if (item.type === 'heading') {
            trans += ` rotateZ(${item.rot}deg)`;
          } else {
            const floatY = Math.sin(t + item.x * 0.01) * 5;
            trans += ` rotateZ(${item.rot}deg) rotateY(${floatY.toFixed(2)}deg)`;
          }
          item.el.style.transform = trans;
        }
      }

      lastCameraZ = state.cameraZ;
      requestAnimationFrame(render);
    }

    // First paint
    if (!reduceMotion) {
      state.visible = true;
      startRender();
    }
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
    initSkillsWarp();

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
