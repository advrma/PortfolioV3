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

  // Weak-device detection — drives a lighter character tier on
  // low-power machines: a smaller, fewer-frame WebP set decoded
  // once into ImageBitmaps (no mid-scroll re-decode), instead of
  // the full 1152×1080 / 300-frame set. `?lp=1` / `?lp=0` forces
  // it on/off for testing.
  const lpParam = new URLSearchParams(location.search).get('lp');
  const isLowPower = lpParam === '1' ? true
    : lpParam === '0' ? false
    : ((navigator.hardwareConcurrency || 8) <= 4
       || (navigator.deviceMemory || 8) <= 4
       || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
       || Math.min(window.innerWidth, window.innerHeight) <= 768);

  // Frames are pre-cropped to the center 1152×1080 (== the canvas
  // 16/15 aspect) and re-encoded to WebP offline by
  // scripts/optimize-frames.js — no transparent gutter shipped.
  //   capable: full set, 300 frames @ 1152×1080, HTMLImageElement
  //   weak:    every 2nd, ~150 frames @ 640×600, decode-once ImageBitmap
  const STEP = isLowPower ? 2 : 1;
  const PAD = 4;                   // filename zero-padding
  const PREFIX = (isLowPower ? 'CYBERFICTION-WEBP-LOW/' : 'CYBERFICTION-WEBP/') + 'male';
  const EXT = '.webp';
  // Decode each weak-tier frame once into an ImageBitmap and hold it,
  // so scrubbing never triggers a re-decode (the source of the stutter).
  const USE_BITMAP = isLowPower && typeof createImageBitmap === 'function';

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
  // Weak tier draws a near-display-size source, so cheap scaling is fine.
  if (isLowPower) cinemaCtx.imageSmoothingQuality = 'low';
  const heroSection = document.getElementById('hero');
  const heroStageUI = document.getElementById('heroStageUI');
  const heroSign = document.getElementById('heroSign');
  const cinemaOverlay = document.getElementById('cinemaOverlay');
  const heroLoading = document.getElementById('heroLoading');
  const heroLoadingPct = document.getElementById('heroLoadingPct');
  const cinemaFrameNum = document.getElementById('cinemaFrameNum');
  const cinemaBar = document.getElementById('cinemaBar');
  const cinemaRuntime = document.getElementById('cinemaRuntime');
  const captions = Array.from(document.querySelectorAll('.cinema__caption'));
  const cinemaAsideLeft = document.getElementById('cinemaAsideLeft');
  const cinemaAsideRight = document.getElementById('cinemaAsideRight');
  let asideSide = 0;   // -1 = right text shown (char left); 1 = left text shown (char right)
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
    // Weak tier: fetch → decode once into an ImageBitmap we keep for
    // the session. Capable tier: plain HTMLImageElement (small WebP).
    if (USE_BITMAP) {
      return fetch(frameUrls[index])
        .then((r) => r.blob())
        .then((blob) => createImageBitmap(blob))
        .then((bmp) => {
          images[index] = bmp;
          loadedCount++;
          updateLoadingUI();
          return bmp;
        })
        .catch(() => {
          loadedCount++;
          updateLoadingUI();
          return null;
        });
    }
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
    renderFrame(0, false);

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
    drawSingleFrame(ctx, canvas, img, xCrop);
  }

  /* Draw a single character image into the canvas without
     clearing — used by renderFrame's cross-fade so we can
     composite two adjacent source frames at fractional alpha
     to produce sub-frame motion blur. */
  function drawSingleFrame(ctx, canvas, img, xCrop) {
    if (!img) return;
    const cw = canvas.width;
    const ch = canvas.height;
    // naturalWidth/Height for HTMLImageElement; width/height for ImageBitmap.
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
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

  /* Draw the character — ONE source frame at full opacity per change.
     (Cross-fading adjacent frames was tried and reverted: it ghosts a
     moving figure and source-over of two semi-transparent draws drops
     the silhouette below full opacity.) Frames are pre-cropped to the
     character region, so xCrop = 1. `idx` may be fractional; rounded to
     the nearest source frame. Skips redraw when the frame is unchanged. */
  function renderFrame(idx, _advancing) {
    const max = FRAME_COUNT - 1;
    let i = Math.round(+idx || 0);
    if (i < 0) i = 0;
    else if (i > max) i = max;
    if (i === lastDrawnFrame) return;
    lastDrawnFrame = i;
    drawImageContain(cinemaCtx, cinemaCanvas, images[i] || nearestLoaded(i), 1);
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
     SIDE STATEMENT — vanilla blur-text-animation port.
     Split each aside into words and stamp per-word blur /
     duration / delay / scale (the React component's computed
     values) onto CSS custom props; the blur-reveal itself is
     the CSS transition toggled by .is-revealed. updateAside()
     flips which side is revealed from the character's scroll-X.
     ------------------------------------------------------- */
  function initBlurAside() {
    [cinemaAsideLeft, cinemaAsideRight].filter(Boolean).forEach((el) => {
      el.setAttribute('aria-label', el.textContent.trim());
      // Walk child nodes so <em> phrases keep their emphasis: collect
      // (word, emphasised?) tokens in document order, then rebuild as
      // per-word blur spans.
      const tokens = [];
      el.childNodes.forEach((node) => {
        const em = node.nodeType === 1 && node.tagName === 'EM';
        (node.textContent || '').split(/\s+/).forEach((w) => {
          if (w) tokens.push({ w, em });
        });
      });
      el.textContent = '';
      const n = tokens.length;
      let prevSpan = null;
      tokens.forEach((tok, i) => {
        const progress = i / n;
        const exp = Math.pow(progress, 0.8) * 0.2;
        const base = i * 0.028;
        const micro = (Math.random() - 0.5) * 0.04;
        const dur = 0.7 + Math.cos(i * 0.3) * 0.18;
        const delay = Math.max(0, base + exp + micro);
        const blur = 8 + Math.floor(Math.random() * 10);    // modest blur — cheaper to raster on big type
        const scale = 0.9 + Math.sin(i * 0.2) * 0.05;
        const span = document.createElement('span');
        span.className = 'cinema__aside-w' + (tok.em ? ' cinema__aside-w--em' : '');
        span.textContent = tok.w;
        span.style.setProperty('--dur', dur.toFixed(2) + 's');
        span.style.setProperty('--delay', delay.toFixed(2) + 's');
        span.style.setProperty('--blur', blur + 'px');
        span.style.setProperty('--scale', scale.toFixed(3));
        // Standalone punctuation (e.g. a period after an <em>) hugs the
        // previous word instead of floating after a word-space.
        if (/^[.,;:!?…)]+$/.test(tok.w) && prevSpan) prevSpan.style.marginRight = '0';
        el.appendChild(span);
        prevSpan = span;
      });
    });
  }

  /* Character LEFT (scrollX < 0) → reveal the RIGHT text; character
     RIGHT (scrollX > 0) → reveal the LEFT text; near centre, hide both.
     The RIGHT text is gated with a small look-ahead so it starts AND
     ends a bit earlier — leading the character into/out of the left
     pose. The LEFT text stays in step. Only touches the DOM on change. */
  const ASIDE_RIGHT_LEAD = 0.045;   // ~12 virtual frames earlier
  function updateAside(timelineProgress) {
    if (!cinemaAsideLeft || !cinemaAsideRight) return;
    const thresh = (motion.scrollShift || 220) * 0.45;
    const xLeftText  = computeScrollX(timelineProgress);                      // in step
    const xRightText = computeScrollX(timelineProgress + ASIDE_RIGHT_LEAD);   // a touch earlier
    let side = 0;
    if (xRightText <= -thresh) side = -1;       // character (nearly) LEFT → right text
    else if (xLeftText >= thresh) side = 1;     // character RIGHT → left text
    if (side === asideSide) return;
    asideSide = side;
    cinemaAsideRight.classList.toggle('is-revealed', side === -1);
    cinemaAsideLeft.classList.toggle('is-revealed', side === 1);
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

  /* -------------------------------------------------------
     UNIFIED HERO MOTION SYSTEM
     One rAF loop handles BOTH the scroll-driven character
     animation (spring physics) AND the cursor parallax (lerp).
     One transform string is written per frame to the canvas.

     Why a single loop and a single transform:
       1. Two rAF loops fight for frame budget. Consolidating
          halves the rAF callback count.
       2. Three setProperty() calls per frame (cursor X, Y,
          scroll X) each invalidate element style. One direct
          transform write is one style mutation per frame.
       3. CSS `calc(var() + var())` recomputed every frame is
          replaced by a JS-computed number; no calc parsing.
       4. Cached `scrollShift` removes the per-frame
          `getBoundingClientRect()` reflow.
     ------------------------------------------------------- */

  const motion = {
    // Cinema-reel timeline — fixed-cadence playback gated by
    // scroll direction. There is no bias, no acceleration —
    // scroll is a play/pause TRIGGER, not a force.
    //   INTRO_DELAY : page load → INTRO_DELAY_MS, animFrame at 0
    //   INTRO       : delay elapsed → animFrame advances at BASE_RATE
    //                  to HOLD_FRAME
    //   HOLD        : animFrame pinned at HOLD_FRAME, awaiting first
    //                  FORWARD scroll
    //   MAIN forward: forward scroll → animFrame advances at BASE_RATE
    //                  toward TIMELINE_MAX
    //   MAIN reverse: reverse scroll → animFrame retreats at BASE_RATE
    //                  toward HOLD_FRAME (UI returns to fully visible
    //                  when animFrame lands there). Reverse stops at
    //                  HOLD_FRAME — the intro is a one-shot, not a
    //                  rewind target.
    //   END         : animFrame at TIMELINE_MAX (forward) or HOLD_FRAME
    //                  (reverse); reel suspends until scroll direction flips
    animFrame: 0,
    hasScrolled: false,         // true once any scroll has occurred (releases HOLD)
    playDirection: 0,           // -1 reverse, 0 paused, 1 forward; set by scroll direction
    introDelayElapsed: false,   // INTRO_DELAY_MS has passed (or skipped by scroll)
    startTime: 0,               // performance.now() at init
    lastScrollProgress: 0,
    // Cursor parallax
    cursorTargetX: 0,
    cursorTargetY: 0,
    cursorRenderedX: 0,
    cursorRenderedY: 0,
    cursorActive: false,
    // Cached layout
    scrollShift: 0,
    pinRect: null,
    // Loop state
    running: false,
    // Visibility gating — the reel suspends entirely while the hero
    // section is off-screen (set by the #hero IntersectionObserver) or
    // the tab is hidden (visibilitychange). No point drawing the
    // character canvas over the warp/gallery sections.
    heroVisible: true,
    pageVisible: true
  };

  /* CINEMA-REEL TIMELINE — fixed cadence, direction-gated.

       Tick rule (in motionTick):
         INTRO/HOLD (!hasScrolled):
           advance forward by BASE_RATE if delay elapsed AND below
           HOLD_FRAME; otherwise idle.
         MAIN (hasScrolled):
           advance by playDirection * BASE_RATE, but only when that
           direction has runway left:
             playDirection ===  1 && animFrame < TIMELINE_MAX → forward
             playDirection === -1 && animFrame > HOLD_FRAME    → reverse
             else                                              → idle.

       Scroll rule (in onUpdate / fallback):
         delta > 0 (forward) → hasScrolled = true; playDirection =  1;
                               introDelayElapsed = true (skip wait)
         delta < 0 (reverse) → hasScrolled = true; playDirection = -1

     Notable invariants:
     • animFrame advances at exactly BASE_RATE — scroll never
       accelerates it, only chooses its direction.
     • After scroll stops, the reel continues in the last
       direction at BASE_RATE until it reaches that direction's
       boundary (0 reverse / TIMELINE_MAX forward).
     • UI exit is gated on hasScrolled and maps from animFrame —
       so reversing animFrame back below HOLD_FRAME naturally
       brings the title/cards back into view.
     • Forward scroll during INTRO_DELAY skips the wait. */
  const TIMELINE_MAX   = TOTAL_VIRTUAL_FRAMES;   // 270
  const HOLD_FRAME     = 73;        // intro endpoint, hold point
  const UI_EXIT_FRAMES = 40;        // animFrame 80→120: UI translates + fades out
  const INTRO_DELAY_MS = 0;         // start immediately when the hero page loads
  // Crawl speed (virtual frames per 60fps tick) — THE smoothness/pacing
  // knob for the continuous reel. With a fixed ~300 source frames the only
  // artifact-free way to be smooth is to play near display-rate: 0.7 ≈ 47fps
  // playback, full main reel in ~4.7s. Higher = faster+smoother (0.9 ≈ 60fps),
  // lower = slower but steppier (0.25 ≈ 16fps was the old choppy crawl).
  // Delta-time keeps the wall-clock speed constant across devices.
  const BASE_RATE      = 0.7;
  const CURSOR_LERP    = 0.10;
  const CURSOR_SETTLE  = 0.2;     // px
  const MAX_CURSOR_TX  = 12;      // ±px, opposite X
  const MAX_CURSOR_TY  = 4;       // ±px, opposite Y

  // When motionTick programmatically scrolls the page to keep
  // scrollY in sync with animFrame, ScrollTrigger still fires
  // onUpdate. This flag tells onUpdate to absorb that auto-scroll
  // delta (update lastScrollProgress only) rather than treat it
  // as user input that could flip the play direction.
  let isAutoScrolling = false;


  /* Recomputed only on init + resize. */
  function refreshHeroLayout() {
    const vw = window.innerWidth;
    const canvasW = cinemaCanvas.offsetWidth || vw;   // offsetWidth is cached
    const sideRoom = Math.max(0, (vw - canvasW) / 2);
    motion.scrollShift = Math.min(vw * 0.22, sideRoom + canvasW * 0.10);
    const pin = document.querySelector('.hero-stage__pin');
    motion.pinRect = pin ? pin.getBoundingClientRect() : null;
    // Cache the absolute scroll range of the hero pin so motionTick
    // can map (animFrame - HOLD_FRAME) → scrollY linearly.
    motion.heroSectionTop = heroSection.offsetTop;
    motion.pinRunway = Math.max(0, heroSection.offsetHeight - window.innerHeight);
  }

  function motionTick() {
    // Suspend the whole reel while the hero is off-screen or the tab is
    // hidden — nothing to draw, and the warp/gallery sections below are
    // the expensive ones. Wakes via kickMotion() on re-enter.
    if (!motion.heroVisible || !motion.pageVisible) {
      motion.running = false;
      motion.lastTickTime = 0;   // force a fresh dt baseline on resume
      return;
    }

    // --- Delta-time: advance by elapsed wall-time, not a fixed amount
    // per tick, so the crawl runs at a constant speed regardless of the
    // device's frame rate (no fps-coupled jitter). `rate` is 1.0 at 60fps.
    const nowT = performance.now();
    let dt = motion.lastTickTime ? nowT - motion.lastTickTime : 16.667;
    motion.lastTickTime = nowT;
    if (dt > 33) dt = 33;        // cap gaps (tab switch / GC) to ~2 frames
    else if (dt < 1) dt = 16.667;
    const rate = dt / 16.667;

    // --- Advance the reel (CONTINUOUS crawl) ---
    //   INTRO (!hasScrolled): autoplay 0 → HOLD_FRAME on load.
    //   MAIN  (hasScrolled):  once the user scrolls, the reel plays
    //     CONTINUOUSLY on its own at BASE_RATE in playDirection until it
    //     reaches that direction's boundary; the page auto-scrolls to
    //     follow. Smoothness comes from (a) delta-time, so speed is
    //     constant regardless of fps, and (b) a high BASE_RATE so playback
    //     runs near display-rate (~1 source frame per tick) instead of the
    //     old steppy ~16fps — with only ~300 source frames that's the only
    //     artifact-free way to be smooth.
    let shouldAdvance;
    let advanceStep = 0;
    if (!motion.hasScrolled) {
      if (!motion.introDelayElapsed) {
        shouldAdvance = false;                 // INTRO_DELAY
      } else if (motion.animFrame >= HOLD_FRAME) {
        motion.animFrame = HOLD_FRAME;         // pin at hold
        shouldAdvance = false;
      } else {
        shouldAdvance = true;                  // INTRO autoplay
        advanceStep = BASE_RATE;
      }
    } else if (motion.playDirection === 1 && motion.animFrame < TIMELINE_MAX) {
      shouldAdvance = true;                     // play forward to the end
      advanceStep = BASE_RATE;
    } else if (motion.playDirection === -1 && motion.animFrame > HOLD_FRAME) {
      shouldAdvance = true;                     // reverse back to the hold pose
      advanceStep = -BASE_RATE;
    } else {
      shouldAdvance = false;
    }

    if (shouldAdvance) {
      motion.animFrame += advanceStep * rate;   // delta-time scaled
      if (motion.animFrame > TIMELINE_MAX) motion.animFrame = TIMELINE_MAX;
      else if (motion.hasScrolled && motion.animFrame < HOLD_FRAME) {
        motion.animFrame = HOLD_FRAME;          // never reverse past the hold
      }
    }

    // NOTE: the reel no longer drives the page scroll. It used to call
    // window.scrollTo() every frame to drag the page along, which fought the
    // user's own scrolling — the page got stuck / snapped back / flickered.
    // The hero is CSS-sticky-pinned, so it stays in view on its own; the
    // character just plays continuously while the user scrolls natively.

    // --- Cursor lerp ---
    const cdx = motion.cursorTargetX - motion.cursorRenderedX;
    const cdy = motion.cursorTargetY - motion.cursorRenderedY;
    motion.cursorRenderedX += cdx * CURSOR_LERP;
    motion.cursorRenderedY += cdy * CURSOR_LERP;

    // --- UI exit (gated on hasScrolled, mapped from animFrame) ---
    const uiP = motion.hasScrolled
      ? clamp01((motion.animFrame - HOLD_FRAME) / UI_EXIT_FRAMES)
      : 0;
    if (heroStageUI) {
      heroStageUI.style.transform =
        'translate3d(0, ' + (-uiP * 110).toFixed(2) + '%, 0)';
      heroStageUI.style.opacity = (1 - uiP).toFixed(3);
    }
    if (heroSign) {
      // Move the signature UP + fade with the UI exit so it scrolls
      // away with everything else instead of staying stuck behind the
      // character. Composed with its centering + tilt; the leading
      // translate is in viewport units (vh) to match the UI's travel.
      heroSign.style.transform =
        'translate3d(0, ' + (-uiP * 110).toFixed(2) + 'vh, 0) translate(-50%, -50%) rotate(-8deg)';
      heroSign.style.opacity = (1 - uiP).toFixed(3);
    }
    if (cinemaOverlay) cinemaOverlay.style.opacity = uiP.toFixed(3);

    // --- Character render from animFrame ---
    const timelineProgress = motion.animFrame / TIMELINE_MAX;
    const { animP } = splitProgress(timelineProgress);
    const scrollX = computeScrollX(timelineProgress);
    const finalX = motion.cursorRenderedX + scrollX;
    cinemaCanvas.style.transform =
      'translate3d(calc(-50% + ' + finalX.toFixed(2) + 'px), ' +
      motion.cursorRenderedY.toFixed(2) + 'px, 0)';
    renderFrame(animP * (FRAME_COUNT - 1), shouldAdvance);
    renderCinemaUI(animP);
    updateAside(timelineProgress);   // reveal the side statement opposite the character

    // --- Suspend when nothing should advance AND cursor settled ---
    // Covers: INTRO_DELAY waiting, HOLD before first scroll,
    // MAIN paused after reverse scroll, END clamped at TIMELINE_MAX.
    // Wake-up paths: setTimeout (delay expiry), onUpdate (scroll
    // input), cursor listeners (calling kickMotion).
    const cursorSettled =
      Math.abs(cdx) < CURSOR_SETTLE && Math.abs(cdy) < CURSOR_SETTLE;

    if (!shouldAdvance && cursorSettled) {
      motion.cursorRenderedX = motion.cursorTargetX;
      motion.cursorRenderedY = motion.cursorTargetY;
      const finalX2 =
        motion.cursorRenderedX + computeScrollX(motion.animFrame / TIMELINE_MAX);
      cinemaCanvas.style.transform =
        'translate3d(calc(-50% + ' + finalX2.toFixed(2) + 'px), ' +
        motion.cursorRenderedY.toFixed(2) + 'px, 0)';
      motion.running = false;
      return;
    }
    requestAnimationFrame(motionTick);
  }

  function kickMotion() {
    // Don't wake the reel while the hero is off-screen or the tab is
    // hidden (re-entry calls kickMotion again to resume).
    if (!motion.heroVisible || !motion.pageVisible) return;
    if (reduceMotionMQ && reduceMotionMQ.matches) {
      // Reduced motion: no autoplay, no intro delay. animFrame
      // tracks raw scroll position 1:1, UI follows the original
      // splitProgress mapping (uiP = scrollProgress / 0.15).
      motion.animFrame = motion.lastScrollProgress * TIMELINE_MAX;
      motion.playDirection = 0;
      motion.cursorRenderedX = motion.cursorTargetX;
      motion.cursorRenderedY = motion.cursorTargetY;
      const progress = motion.animFrame / TIMELINE_MAX;
      const { uiP, animP } = splitProgress(progress);
      if (heroStageUI) {
        heroStageUI.style.transform =
          'translate3d(0, ' + (-uiP * 110).toFixed(2) + '%, 0)';
        heroStageUI.style.opacity = (1 - uiP).toFixed(3);
      }
      if (heroSign) {
        heroSign.style.transform =
          'translate3d(0, ' + (-uiP * 110).toFixed(2) + 'vh, 0) translate(-50%, -50%) rotate(-8deg)';
        heroSign.style.opacity = (1 - uiP).toFixed(3);
      }
      if (cinemaOverlay) cinemaOverlay.style.opacity = uiP.toFixed(3);
      const fx = motion.cursorRenderedX + computeScrollX(progress);
      cinemaCanvas.style.transform =
        'translate3d(calc(-50% + ' + fx.toFixed(2) + 'px), ' +
        motion.cursorRenderedY.toFixed(2) + 'px, 0)';
      // Reduced-motion path: no accumulation — clean single-frame paint.
      renderFrame(animP * (FRAME_COUNT - 1), false);
      renderCinemaUI(animP);
      return;
    }
    if (motion.running) return;
    motion.running = true;
    requestAnimationFrame(motionTick);
  }

  function computeScrollX(progress) {
    if (reduceMotionMQ && reduceMotionMQ.matches) return 0;

    const frame = progress * TOTAL_VIRTUAL_FRAMES;
    const SHIFT = motion.scrollShift;   // cached at init/resize
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
     GSAP ScrollTrigger setup — the hero pin trigger only
     samples scroll delta and feeds it as a bias impulse to
     the cinema-reel timeline (see motionTick). UI exit,
     character frame, and HUD overlay are all rendered from
     the autoplay timeline inside motionTick — NOT from the
     raw scroll position — so they always stay in sync with
     the reel even when the user holds still.
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
        // Same direction-selector rule as the GSAP path.
        // Auto-scrolls from motionTick are absorbed without flipping.
        if (isAutoScrolling) {
          motion.lastScrollProgress = p;
          return;
        }
        const deltaProgress = p - motion.lastScrollProgress;
        if (deltaProgress > 0) {
          motion.hasScrolled = true;
          motion.playDirection = 1;
          motion.introDelayElapsed = true;
        } else if (deltaProgress < 0) {
          motion.hasScrolled = true;
          motion.playDirection = -1;
        }
        motion.lastScrollProgress = p;
        kickMotion();
      };
      window.addEventListener('scroll', fallback, { passive: true });
      // The hero reel's kick happens in startHeroReel(), which
      // is invoked once the intro loader finishes.
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    // Direct scrub on the hero (`scrub: true`). The trigger
    // exists only to sample scroll DIRECTION; it does not
    // modulate animFrame. motionTick is the sole owner of the
    // reel's advancement (fixed BASE_RATE forward).
    gsap.to(frameState, {
      idx: FRAME_COUNT - 1,
      ease: 'none',
      scrollTrigger: {
        trigger: heroSection,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        invalidateOnRefresh: true,
        onRefresh: refreshHeroLayout,    // cache layout on resize
        onUpdate: (self) => {
          // Scroll = direction selector. Forward scroll plays
          // the reel forward; reverse scroll plays it backward.
          // The reel continues at BASE_RATE in whichever
          // direction was set last, until it hits that
          // direction's boundary.
          // Auto-scrolls from motionTick are absorbed (lastScrollProgress
          // updated) without flipping playDirection.
          const newProgress = self.progress;
          if (isAutoScrolling) {
            motion.lastScrollProgress = newProgress;
            return;
          }
          const deltaProgress = newProgress - motion.lastScrollProgress;
          if (deltaProgress > 0) {
            motion.hasScrolled = true;
            motion.playDirection = 1;
            motion.introDelayElapsed = true;   // skip intro wait if still pending
          } else if (deltaProgress < 0) {
            motion.hasScrolled = true;
            motion.playDirection = -1;
          }
          motion.lastScrollProgress = newProgress;
          kickMotion();
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

    // The hero reel's kick happens in startHeroReel(), which is
    // invoked once the intro loader finishes its timeline.
  }

  /* -------------------------------------------------------
     startHeroReel — gated kickoff for the cinema reel.
     Called once the intro loader has finished its animation
     (or immediately if the loader can't run). Paints the
     initial frame and schedules the INTRO_DELAY wake-up.
     ------------------------------------------------------- */
  function startHeroReel() {
    motion.startTime = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    kickMotion();
    setTimeout(() => {
      if (!motion.introDelayElapsed) {
        motion.introDelayElapsed = true;
        kickMotion();   // wake the loop to begin INTRO autoplay
      }
    }, INTRO_DELAY_MS);
    // Now that the real reel is running, measure the live frame rate.
    runPerfProbe();
  }

  /* -------------------------------------------------------
     initPreloader — noise / grain reveal.
     Heavy film grain covers the empty hero background; a soft
     horizontal mask (--wipe) dissolves it left to right so the
     ADITYA VERMA wordmark emerges, then the whole preloader fades
     and the hero takes over. Removing .is-pre-load kicks the hero
     name's handwriting draw-on. rAF-driven; safety-timed.
     ------------------------------------------------------- */
  function initPreloader() {
    const loader = document.getElementById('preloader');
    if (!loader) { startHeroReel(); return; }
    const grain = document.getElementById('preloaderGrain');

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let done = false;
    function finishLoader() {
      if (done) return;
      done = true;
      document.body.classList.remove('is-pre-load');   // kicks the hero name draw-on
      document.body.style.overflow = prevOverflow;
      startHeroReel();
      setTimeout(() => loader.classList.add('is--gone'), 750);
    }
    function exit() {
      clearTimeout(safety);
      loader.classList.add('is--fading');               // fade preloader out
      setTimeout(finishLoader, 700);                    // then hand off to the hero
    }

    // Absolute safety — never leave the user stuck on the loader.
    const safety = setTimeout(exit, 9000);

    // Reduced motion: skip the grain reveal, fade straight in.
    if (reduceMotionMQ && reduceMotionMQ.matches) {
      if (grain) grain.style.setProperty('--wipe', '105%');
      setTimeout(exit, 350);
      return;
    }

    const DURATION = 3000;   // grain dissolves over this long
    const HOLD = 560;        // hold on the revealed name before exit
    // easeInOutQuad
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const t0 = performance.now();

    function frame(now) {
      const p = Math.min((now - t0) / DURATION, 1);
      // --wipe runs -10% -> 105%, dissolving the grain left to right.
      if (grain) grain.style.setProperty('--wipe', (-10 + ease(p) * 115).toFixed(2) + '%');
      if (p < 1) requestAnimationFrame(frame);
      else setTimeout(exit, HOLD);
    }
    requestAnimationFrame(frame);
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
      refreshHeroLayout();      // re-cache scrollShift + pinRect
      if (typeof ScrollTrigger !== 'undefined') {
        ScrollTrigger.refresh();
      } else {
        renderFrame(frameState.idx, false);
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
     CURSOR PARALLAX LISTENERS — the rAF work happens inside
     the unified `motionTick`; these listeners only update
     `motion.cursorTargetX/Y` and kick the loop. Pin bounds
     are read from the cached `motion.pinRect` (refreshed on
     resize), never per-event. */
  function initCursorParallax() {
    const pin = document.querySelector('.hero-stage__pin');
    if (!pin) return;
    if (reduceMotionMQ && reduceMotionMQ.matches) return;

    pin.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const rect = motion.pinRect;
      if (!rect) return;
      const halfW = rect.width  / 2;
      const halfH = rect.height / 2;
      const nx = (e.clientX - rect.left - halfW) / halfW;
      const ny = (e.clientY - rect.top  - halfH) / halfH;
      // Both axes opposite cursor (depth parallax). Y is tiny.
      motion.cursorTargetX = -nx * MAX_CURSOR_TX;
      motion.cursorTargetY = -ny * MAX_CURSOR_TY;
      motion.cursorActive = true;
      kickMotion();
    }, { passive: true });

    pin.addEventListener('pointerleave', () => {
      motion.cursorTargetX = 0;
      motion.cursorTargetY = 0;
      motion.cursorActive = false;
      kickMotion();
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
    const scanlines = section.querySelector('.warp__scanlines');

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

    // Shared per-item paint pass. Called once now to set the correct
    // INITIAL frame (cameraZ = 0) before the render loop runs, and
    // again by render() each animation tick. Without this initial
    // pass, the render loop's "nearlyStill" early-return on first
    // paint left every item without an inline transform, so they all
    // collapsed onto the world center via the CSS translate(-50%,-50%)
    // and the last-appended card flashed on top before the first scroll.
    function paintItems(cameraZ, velocity, t) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const vizZ = item.baseZ + cameraZ;

        let alpha;
        if (vizZ < -3200)      alpha = 0;
        else if (vizZ < -2200) alpha = (vizZ + 3200) / 1000;
        else if (vizZ > 80 && item.type !== 'star') alpha = Math.max(0, 1 - (vizZ - 80) / 1600);
        else                   alpha = 1;
        if (alpha < 0) alpha = 0;
        // Write opacity only when it actually changed (most items hold a
        // steady 1 or 0 across frames) — avoids ~hundreds of redundant
        // style mutations per frame. First paint writes (cache undefined).
        const op = alpha.toFixed(3);
        if (op !== item._lastOp) { item.el.style.opacity = op; item._lastOp = op; }

        let trans = `translate3d(${item.x}px, ${item.y}px, ${vizZ.toFixed(1)}px)`;
        if (item.type === 'star') {
          const stretch = Math.max(1, Math.min(1 + Math.abs(velocity) * 0.06, 8));
          trans += ` scale3d(1, 1, ${stretch.toFixed(2)})`;
        } else if (item.type === 'heading') {
          trans += ` rotateZ(${item.rot}deg)`;
        } else {
          const floatY = Math.sin(t + item.x * 0.01) * 5;
          trans += ` rotateZ(${item.rot}deg) rotateY(${floatY.toFixed(2)}deg)`;
        }
        // Same for the transform — skip the write when unchanged.
        if (trans !== item._lastTr) { item.el.style.transform = trans; item._lastTr = trans; }
      }
    }

    // Apply the correct first-frame state immediately (cameraZ=0, no
    // velocity, no time-based float) so the section reads as the
    // composed "LANGUAGES heading + cards behind" pose from the
    // moment it scrolls into view — not a flash of the last card.
    paintItems(0, 0, 0);

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
      // Camera flythrough scrub: skip the first 100vh of the section
      // (that 100vh is the hero→skills reveal zone, where the warp pin
      // sits behind the un-sticking hero). The scrub still runs over
      // exactly 500vh, so the camera timing is identical to before.
      gsap.to(state, {
        cameraZ: CAMERA_END,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: () => 'top+=' + window.innerHeight + ' top',
          end:   () => '+=' + (window.innerHeight * 5),
          scrub: 1.6,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            state.targetVel = self.getVelocity();
            startRender();
          }
        }
      });

      // Visibility trigger covers the FULL section so the warp scene
      // is already rendering (initial paint) while the hero is still
      // sliding up over it, and stays rendering through the gallery's
      // slide-up that happens behind the warp's last 100vh of sticky.
      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end:   'bottom bottom',
        invalidateOnRefresh: true,
        onEnter:     () => { state.visible = true;  if (scanlines) scanlines.style.display = ''; startRender(); },
        onEnterBack: () => { state.visible = true;  if (scanlines) scanlines.style.display = ''; startRender(); },
        onLeave:     () => { state.visible = false; if (scanlines) scanlines.style.display = 'none'; },
        onLeaveBack: () => { state.visible = false; if (scanlines) scanlines.style.display = 'none'; }
      });
      // Start hidden until the section enters (the full-viewport
      // mix-blend overlay shouldn't composite while it's off-screen).
      if (scanlines) scanlines.style.display = 'none';

      // Subtle parallax depth on the warp pin during the hero reveal:
      // translateY 8vh → 0 over the first 100vh of the section. Combined
      // with the hero sliding up in front, the skills layer feels like
      // it was already there and is "settling into place" as it's
      // exposed.
      const warpPin = section.querySelector('.warp__pin');
      if (warpPin) {
        gsap.fromTo(warpPin,
          { y: () => window.innerHeight * 0.08 },
          {
            y: 0,
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: () => 'top+=' + window.innerHeight + ' top',
              scrub: true,
              invalidateOnRefresh: true
            }
          }
        );
      }

      // 3D lift on the hero pin during its slide-up. As the pin un-sticks
      // and scrolls naturally up off-screen (sticky CSS, no JS Y-translate),
      // we also scrub a subtle rotateX + scale on it — so it reads as a
      // physical foreground PANEL receding in 3D space rather than a flat
      // page sliding. Combined with `perspective: 1500px` on .hero-stage
      // and `transform-origin: 50% 0%` on the pin, the pivot is the top
      // edge: the bottom of the panel is what tilts back as it lifts.
      // The pin's existing box-shadow gives a soft ambient drop onto the
      // skills layer behind, completing the depth read.
      const heroPin = heroSection ? heroSection.querySelector('.hero-stage__pin') : null;
      if (heroPin) {
        gsap.fromTo(heroPin,
          { rotateX: 0, scale: 1 },
          {
            // Negative rotateX with origin: 50% 0% (top center) tilts the
            // BOTTOM edge backward (away from viewer in +Z) — the panel
            // looks like it's lifting away. ~7° + 1.5% scale-down is the
            // subtle, premium range (the user explicitly asked for not
            // exaggerated). Positive rotateX would do the opposite
            // (bottom forward), which would feel like the panel is
            // falling toward the viewer.
            rotateX: -7,
            scale: 0.985,
            ease: 'none',
            scrollTrigger: {
              trigger: heroSection,
              start: 'bottom bottom',   // scrollY = hero.bottom - viewportH (= 120vh: pin just un-sticks)
              end:   'bottom top',      // scrollY = hero.bottom (= 220vh: pin fully off-screen)
              scrub: true,
              invalidateOnRefresh: true
            }
          }
        );
      }

      // Cinematic blur reveal on the SKILLS back layer. While the hero
      // foreground covers the skills, the warp scene sits in soft focus;
      // as the hero slides up and exposes more of the back layer, the
      // blur scrubs to 0 so the skills resolve crisp by the time the
      // hero is fully gone. Filter lives on .warp__pin (the visible
      // scene), so the foreground hero (character / CTA / cream BG)
      // is never blurred. Tied to the exact same hero slide-up range
      // as the 3D lift above.
      gsap.fromTo(warpPin,
        { filter: 'blur(10px)' },
        {
          filter: 'blur(0px)',
          ease: 'none',
          scrollTrigger: {
            trigger: heroSection,
            start: 'bottom bottom',     // scrollY ≈ 120vh — hero pin starts un-sticking
            end:   'bottom top',        // scrollY ≈ 220vh — hero pin fully off-screen
            scrub: true,
            invalidateOnRefresh: true,
            // Clear the filter entirely once the reveal completes so
            // the warp scene doesn't carry an unnecessary `blur(0)`
            // compositor pass through the rest of its 500vh runway.
            // Restored on scroll-back via onLeaveBack so re-entering
            // the reveal from below starts soft-focus again.
            onLeave:     () => { warpPin.style.filter = ''; },
            onLeaveBack: () => { warpPin.style.filter = 'blur(10px)'; }
          }
        }
      );
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
      startRender();   // resume loop to apply tilt
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

      // Suspend whenever nothing is animating — visibility is
      // not enough on its own to keep the loop running. The next
      // scroll update or mousemove will call startRender() again.
      const nearlyStill = Math.abs(state.targetVel) < 1
                       && Math.abs(state.velocity)  < 0.01;
      if (nearlyStill) {
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

      // Item transforms — shared with the initial-frame paint so the
      // first scrolled-into-view state matches the composed pose
      // exactly (no flash of a different card on top).
      paintItems(state.cameraZ, state.velocity, time * 0.001);

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
     PROJECTS — INFINITE GALLERY HALL
     Three.js 3D wall of project "paintings". The .hall
     section provides a 500vh vertical runway; .hall__pin
     is sticky 100vh and holds a fullscreen canvas + UI
     overlay. ScrollTrigger scrubs the user's vertical scroll
     progress into the camera's horizontal target along the
     gallery wall. The rAF render loop self-suspends when the
     section is not in view.
     ------------------------------------------------------- */
  function initProjectsHall() {
    if (typeof THREE === 'undefined') return;
    const section    = document.getElementById('projects');
    const canvasHost = document.getElementById('hallCanvas');
    if (!section || !canvasHost) return;

    const SLIDE_COUNT = 3;
    const SPACING_X   = 45;     // 3D units between paintings
    const P_WIDTH     = 14;
    const P_HEIGHT    = 18;
    const CAM_Z       = 30;
    const WALL_ANGLE  = -0.25;  // wall recedes to the right
    const BG_HEX      = 0xF4F1EA;

    // Placeholder painting images — abstract / tech-feel covers
    // for each project card. Swap with real shots later.
    const IMAGES = [
      'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=900&q=80',
      'https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=900&q=80',
      'https://images.unsplash.com/photo-1535378917042-10a22c95931a?w=900&q=80'
    ];

    const scene = new THREE.Scene();
    // Transparent scene background (renderer alpha:true) so the
    // .hall__pin's cream + cloned .pin-topo contours show through the
    // canvas — the gallery then shares the same paper backdrop as the
    // rest of the page. Fog still fades distant paintings toward the
    // cream tone (fog.color is independent of scene.background), so
    // depth reads the same as before; empty wall area is now the pin.
    scene.background = null;
    scene.fog = new THREE.Fog(BG_HEX, 14, 130);

    const camera = new THREE.PerspectiveCamera(
      45, canvasHost.clientWidth / canvasHost.clientHeight, 0.1, 1000
    );
    camera.position.set(0, 0, CAM_Z);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    canvasHost.appendChild(renderer.domElement);

    // Directional (horizontal) motion blur. A GPU-accelerated SVG
    // gaussian-blur filter applied to the canvas, with its X stdDeviation
    // driven by camera velocity each frame — so the wall smears
    // horizontally while panning and snaps sharp when it settles. The
    // filter is removed entirely when idle so it costs nothing at rest.
    let blurFE = null;
    let blurOn = false;
    (function setupMotionBlur() {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
      const filter = document.createElementNS(NS, 'filter');
      filter.setAttribute('id', 'hallMotionBlur');
      filter.setAttribute('x', '-25%');
      filter.setAttribute('y', '-2%');
      filter.setAttribute('width', '150%');
      filter.setAttribute('height', '104%');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      blurFE = document.createElementNS(NS, 'feGaussianBlur');
      blurFE.setAttribute('in', 'SourceGraphic');
      blurFE.setAttribute('stdDeviation', '0 0');
      filter.appendChild(blurFE);
      svg.appendChild(filter);
      document.body.appendChild(svg);
    })();
    function updateMotionBlur(vel) {
      if (!blurFE) return;
      // Map camera velocity (world units/frame) → horizontal blur px.
      const blur = Math.min(vel * 4.5, 18);
      if (blur < 0.5) {
        if (blurOn) { renderer.domElement.style.filter = 'none'; blurOn = false; }
        return;
      }
      blurFE.setAttribute('stdDeviation', blur.toFixed(2) + ' 0');
      if (!blurOn) {
        renderer.domElement.style.filter = 'url(#hallMotionBlur)';
        blurOn = true;
      }
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.45);
    dir.position.set(10, 20, 10);
    scene.add(dir);

    const galleryGroup = new THREE.Group();
    galleryGroup.rotation.y = WALL_ANGLE;
    galleryGroup.position.x = 8;
    scene.add(galleryGroup);

    const loader   = new THREE.TextureLoader();
    const planeGeo = new THREE.PlaneGeometry(P_WIDTH, P_HEIGHT);
    const lineMat  = new THREE.LineBasicMaterial({ color: 0xDED7C8 });
    const outlineMat = new THREE.LineBasicMaterial({ color: 0x222222 });

    const paintingGroups = [];
    for (let i = 0; i < SLIDE_COUNT; i++) {
      const g = new THREE.Group();
      g.position.set(i * SPACING_X, 0, 0);

      const mat  = new THREE.MeshBasicMaterial({ color: 0xe8e3d6 });
      const mesh = new THREE.Mesh(planeGeo, mat);
      loader.load(IMAGES[i] || IMAGES[0], (tex) => {
        if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      });

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(planeGeo), outlineMat
      );

      const shadowMat  = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.12
      });
      const shadow = new THREE.Mesh(planeGeo, shadowMat);
      shadow.position.set(0.8, -0.8, -0.5);

      // Top + bottom horizontal "wall lines" between adjacent paintings
      const half = SPACING_X / 2;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-half,  14, -1), new THREE.Vector3(half,  14, -1),
        new THREE.Vector3(-half, -14, -1), new THREE.Vector3(half, -14, -1)
      ]);
      const lines = new THREE.LineSegments(lineGeo, lineMat);

      g.add(shadow);
      g.add(mesh);
      g.add(outline);
      g.add(lines);
      galleryGroup.add(g);
      paintingGroups.push(g);
    }

    let currentScroll = 0;
    let targetScroll  = 0;
    let prevScroll    = 0;
    let blurVel       = 0;
    const mouse       = { x: 0, y: 0 };
    let visible       = false;
    let raf           = 0;
    // Moderate lerp on the scroll-driven camera target — relaxes the
    // pan between projects so it eases in/out instead of locking 1:1
    // with the scroll wheel. Fast enough (0.11) that the lerp still
    // catches up to the last project well before the section releases,
    // so the "last project skipped" bug doesn't return.
    const SCROLL_LERP = 0.11;

    // Update which slide-content panel is active based on
    // the camera's current horizontal position along the wall.
    let lastActiveIdx = -1;
    const slideEls = [];
    for (let i = 0; i < SLIDE_COUNT; i++) {
      slideEls.push(document.getElementById('hallSlide-' + i));
    }
    function updateUI(scrollX) {
      const raw  = Math.round(scrollX / SPACING_X);
      const idx  = ((raw % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT;
      if (idx === lastActiveIdx) return;
      lastActiveIdx = idx;
      for (let i = 0; i < SLIDE_COUNT; i++) {
        if (!slideEls[i]) continue;
        slideEls[i].classList.toggle('is-active', i === idx);
      }
    }
    // Activate first slide immediately so the panel is visible
    // when the section first scrolls into view.
    updateUI(0);

    function render() {
      raf = 0;
      if (!visible) {
        // Section left view: let any residual motion blur decay out.
        if (blurVel > 0.03) { blurVel *= 0.8; updateMotionBlur(blurVel); kickRender(); }
        else updateMotionBlur(0);
        return;
      }
      // Eased follow — the camera lerps toward the scroll-driven
      // target so transitions between projects glide instead of
      // locking 1:1 to the scroll wheel. The lerp also drives the
      // motion blur (delta-per-frame = blur input), so faster
      // catch-up = more smear. Snap to target once the gap is
      // negligible so the camera always actually reaches the last
      // project before the section releases.
      currentScroll += (targetScroll - currentScroll) * SCROLL_LERP;
      if (Math.abs(targetScroll - currentScroll) < 0.001) currentScroll = targetScroll;
      const instVel = Math.abs(currentScroll - prevScroll);
      prevScroll = currentScroll;

      // Motion blur: snap up to the current velocity, then decay so
      // the horizontal smear trails off smoothly after scrolling stops
      // (and the wall resolves crisp on the project you land on).
      blurVel = Math.max(blurVel * 0.8, instVel);
      updateMotionBlur(blurVel);

      const xMove = currentScroll * Math.cos(WALL_ANGLE);
      const zMove = currentScroll * Math.sin(WALL_ANGLE);
      camera.position.x = xMove;
      camera.position.z = CAM_Z - zMove;

      camera.rotation.x = mouse.y * 0.04;
      camera.rotation.y = -mouse.x * 0.04;

      updateUI(currentScroll);
      renderer.render(scene, camera);

      // Keep ticking while the camera is still easing toward target
      // OR while motion blur is decaying — so both the pan and the
      // smear finish smoothly after scrolling stops.
      if (currentScroll !== targetScroll || blurVel > 0.03) kickRender();
    }
    function kickRender() {
      if (raf) return;
      raf = requestAnimationFrame(render);
    }

    // Mouse parallax — subtle camera tilt
    if (!(reduceMotionMQ && reduceMotionMQ.matches)) {
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        if (visible) kickRender();
      }, { passive: true });
    }

    // Resize: re-fit renderer + camera aspect to the canvas host
    function resize() {
      const w = canvasHost.clientWidth;
      const h = canvasHost.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      kickRender();
    }
    window.addEventListener('resize', resize);

    // ----- Theme-aware wall lines -----
    // The thin "wall lines" between paintings are a light cream-gray so they
    // read as faint seams against the cream backdrop. Once the page flips to
    // dark (scrolling into the experience section) the transparent gallery
    // canvas shows the dark page through it, and that light line suddenly
    // stands out as a bright diagonal. Swap the line color to the dark page
    // tone whenever html.is-dark is active so it stays invisible, and force an
    // immediate repaint — the render loop is often idle by the time the page
    // has gone dark, so it wouldn't otherwise pick up the color change.
    const applyHallTheme = () => {
      const dark = document.documentElement.classList.contains('is-dark');
      // Light: faint cream wall lines. Dark: hide them entirely — against the
      // dark page they only read as a stray diagonal across the screen.
      lineMat.color.set(0xDED7C8);
      lineMat.transparent = true;
      lineMat.opacity = dark ? 0 : 1;
      renderer.render(scene, camera);
    };
    new MutationObserver(applyHallTheme).observe(document.documentElement, {
      attributes: true, attributeFilter: ['class']
    });
    applyHallTheme();

    // ----- Free-scroll camera pan with per-project hold zones -----
    // The page scroll is NEVER locked or hijacked, so the section can
    // never trap you. The camera is tied DIRECTLY to scroll progress
    // (no glide tween that could lag behind a fast scroll), so the
    // project on screen always matches the scroll position — including
    // the LAST project, which is reached and held before the section
    // releases. An eased piecewise mapping gives each project a clear
    // "dwell" zone with smooth pans in between, so every project is
    // shown cleanly before the page moves on.
    const SPAN = SLIDE_COUNT - 1;
    function progressToScroll(progress) {
      const raw = Math.max(0, Math.min(SPAN, progress * SPAN));
      const idx = Math.min(SPAN - 1, Math.floor(raw));
      const frac = raw - idx;
      // Lighter hold zones (8% on each side) and a wider eased
      // transition (the middle 84%) — combined with the SCROLL_LERP
      // smoothing in render(), the pan between projects feels more
      // relaxed and flowing instead of snappy. `smootherstep` (Perlin)
      // is even smoother at the endpoints than smoothstep, so the
      // settle into each project's hold zone is gentler.
      let t = (frac - 0.08) / 0.84;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const eased = t * t * t * (t * (t * 6 - 15) + 10);  // smootherstep
      return Math.min(idx + eased, SPAN) * SPACING_X;
    }

    // Scroll position the camera lands on at the first/last project —
    // reused by the slide-up tween, the camera onUpdate, and the
    // onLeave hard-snap that guards against the lerp lag skipping the
    // last project on a fast scroll past the section.
    const LAST_SCROLL = (SLIDE_COUNT - 1) * SPACING_X;

    // Force the camera to a specific position and paint ONE frame
    // synchronously. Used in onLeave / onLeaveBack so the gallery's
    // parting frame is always the boundary project — even when a
    // fast scroll outran the smoothing lerp and left currentScroll
    // mid-pan at the moment the section released.
    function snapPaintAt(scroll) {
      currentScroll = scroll;
      targetScroll  = scroll;
      prevScroll    = scroll;
      blurVel       = 0;
      const xMove = scroll * Math.cos(WALL_ANGLE);
      const zMove = scroll * Math.sin(WALL_ANGLE);
      camera.position.x = xMove;
      camera.position.z = CAM_Z - zMove;
      updateUI(scroll);
      renderer.render(scene, camera);
      updateMotionBlur(0);
    }

    if (typeof ScrollTrigger !== 'undefined') {
      // Slide-up transition: as the user scrolls into the section, the
      // pin (the actual cream front layer with the canvas + UI) starts
      // 100vh below the viewport and translates up to 0 over the first
      // 100vh of scroll — sliding over the still-pinned skills section
      // behind it. We animate .hall__pin specifically (not .hall) so
      // the trigger element's rect stays at its layout position and
      // the camera-pan ScrollTrigger below calculates start/end
      // correctly.
      const hallPin = section.querySelector('.hall__pin');
      const reduceMotion = reduceMotionMQ && reduceMotionMQ.matches;
      if (hallPin && !reduceMotion) {
        // 3D slide-up: the gallery pin rises from one viewport below
        // (translateY: 100vh → 0) AND scrubs a subtle rotateX + scale
        // alongside it. Combined with `perspective: 1500px` on .hall
        // and `transform-origin: 50% 0%` on the pin, the panel arrives
        // tilted (bottom recessed in -Z) and flattens into place over
        // the still-pinned skills layer behind — the same 3D feel as
        // the hero's lift, mirrored for an entering panel. The pin's
        // top-edge box-shadow rides the seam during the rise, giving
        // a clear depth separation from the skills back layer.
        gsap.fromTo(hallPin,
          { y: () => window.innerHeight, rotateX: -10, scale: 0.99 },
          {
            y: 0,
            rotateX: 0,
            scale: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: () => 'top+=' + window.innerHeight + ' top',
              scrub: true,
              invalidateOnRefresh: true
            }
          }
        );
      }

      // The pin is opaque cream while the dark skills section is still behind
      // it (the slide-up + overlap, ~first 2 viewports of this section). Once
      // that's past, turn it transparent (.hall__pin--clear) so the gallery
      // shows the SAME global cream+topo background as every other section.
      if (hallPin) {
        ScrollTrigger.create({
          trigger: section,
          start: () => 'top top-=' + (window.innerHeight * 2),
          invalidateOnRefresh: true,
          onEnter: () => hallPin.classList.add('hall__pin--clear'),
          onLeaveBack: () => hallPin.classList.remove('hall__pin--clear'),
        });
      }

      // Camera scroll trigger. The trigger range covers BOTH the slide-up
      // transition (first 100vh) AND the camera pan (the remaining ~280vh).
      // We keep onEnter firing at 'top top' so `visible` flips true the
      // moment the pin starts sliding into view (so the canvas is being
      // rendered as it appears, not after). The camera target uses an
      // ADJUSTED progress that holds at 0 until the slide-up completes,
      // then pans through projects over the remaining runway — so the
      // first project is in view the whole time the gallery is rising,
      // and the camera only starts panning once the section has fully
      // covered the viewport.
      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom bottom',
        invalidateOnRefresh: true,
        onEnter:     () => { visible = true;  kickRender(); },
        onEnterBack: () => { visible = true;  kickRender(); },
        // Hard snap to the last project on forward exit (and the
        // first on backward exit) so the gallery's final frame is
        // ALWAYS the boundary project — even when a violent scroll
        // outran the smoothing lerp and left it mid-pan. Without
        // this, fast scrolls past the section showed the camera
        // half-way between project 3 and project 4 as the page
        // released, then jumped to "Numbers that move".
        onLeave:     () => { snapPaintAt(LAST_SCROLL); visible = false; },
        onLeaveBack: () => { snapPaintAt(0);            visible = false; },
        onUpdate: (self) => {
          const total = self.end - self.start;
          const skip  = window.innerHeight;          // transition zone (100vh)
          const frac  = total > 0 ? skip / total : 0;
          let adj     = frac >= 1
                          ? 0
                          : Math.max(0, (self.progress - frac) / (1 - frac));
          // End buffer: lock the camera target at the last project
          // for the final ~12% of the camera runway. Gives the lerp
          // a natural runway to settle on the last project before
          // the section actually exits — covers slow/moderate
          // scrolls; the onLeave snap covers very fast scrolls.
          if (adj > 0.88) adj = 1;
          targetScroll = progressToScroll(adj);
          kickRender();
        }
      });
    }
  }

  /* -------------------------------------------------------
     INIT
     ------------------------------------------------------- */
  /* -------------------------------------------------------
     HYPER-TEXT DECRYPTION — vanilla port of the React component
     hyper-text-with-decryption.tsx. For every paragraph marked
     [data-hyper] in the markup, every word is wrapped in a
     .hyper-word span; words whose cleaned form (lowercased,
     non-alphanumerics stripped) matches an entry in the
     paragraph's `data-hl-words` get .is-hl (interactive).
     Hovering an interactive word dims the rest of the
     paragraph, scales/pillates the hovered word, and
     scrambles its glyphs through random chars before
     resolving back to the original. CSS handles the visuals;
     this function only owns the word-wrapping + scramble loop.
     ------------------------------------------------------- */
  function initHyperText() {
    const paragraphs = document.querySelectorAll('[data-hyper]');
    if (!paragraphs.length) return;

    const CHARS              = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+';
    const CYCLES_PER_LETTER  = 3;
    const SCRAMBLE_SPEED_MS  = 30;
    const clean = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

    paragraphs.forEach((p) => {
      if (p.dataset.hyperReady === '1') return;
      p.dataset.hyperReady = '1';

      const hlSet = new Set(
        (p.dataset.hlWords || '')
          .split(',')
          .map((w) => clean(w))
          .filter(Boolean)
      );

      // Capture the existing text and rebuild the paragraph with
      // each word in its own span. Collapse all whitespace so we
      // emit a single space character between words; the original
      // line-wrapping is irrelevant once the markup is rebuilt.
      const text = (p.textContent || '').trim().replace(/\s+/g, ' ');
      p.textContent = '';

      const words = text.split(' ');
      words.forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'hyper-word';
        span.dataset.original = word;
        span.textContent = word;
        if (hlSet.has(clean(word))) {
          span.classList.add('is-hl');
          // Keyboard accessibility: make the interactive word focusable.
          span.tabIndex = 0;
        }
        p.appendChild(span);
        if (i < words.length - 1) {
          p.appendChild(document.createTextNode(' '));
        }
      });

      // Wire scramble + dim/highlight on every interactive word.
      const hlEls = p.querySelectorAll('.hyper-word.is-hl');
      hlEls.forEach((el) => {
        const original = el.dataset.original || '';
        let timer = null;

        const startScramble = () => {
          if (timer) clearInterval(timer);
          let pos = 0;
          timer = setInterval(() => {
            let scrambled = '';
            for (let i = 0; i < original.length; i++) {
              if (pos / CYCLES_PER_LETTER > i) {
                scrambled += original.charAt(i);
              } else {
                scrambled += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
              }
            }
            el.textContent = scrambled;
            pos++;
            if (pos >= original.length * CYCLES_PER_LETTER) {
              clearInterval(timer);
              timer = null;
              el.textContent = original;
            }
          }, SCRAMBLE_SPEED_MS);
        };

        const stopScramble = () => {
          if (timer) { clearInterval(timer); timer = null; }
          el.textContent = original;
        };

        const enter = () => {
          p.classList.add('is-hyper-hover');
          el.classList.add('is-hovered');
          startScramble();
        };
        const leave = () => {
          p.classList.remove('is-hyper-hover');
          el.classList.remove('is-hovered');
          stopScramble();
        };

        el.addEventListener('mouseenter', enter);
        el.addEventListener('mouseleave', leave);
        el.addEventListener('focus',  enter);
        el.addEventListener('blur',   leave);
      });
    });
  }

  /* -------------------------------------------------------
     initTextScramble — vanilla port of the react
     text-scramble component. Each [data-scramble-text] host
     is rebuilt into per-character spans + an animated
     underline + a glow layer. On mouseenter/focus the chars
     cycle through random ASCII glyphs and resolve left → right
     at 30ms intervals over (text.length * 3) frames, matching
     the React algorithm exactly.
     ------------------------------------------------------- */
  function initTextScramble() {
    const targets = document.querySelectorAll('[data-scramble-text]');
    if (!targets.length) return;

    const CHARS            = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
    const INTERVAL_MS      = 30;
    const FRAMES_PER_CHAR  = 3;

    // Every non-space char span across all scramble hosts. We lock each to
    // its natural (resolved-text) width so swapping in random glyphs during
    // the scramble can't change a word's width — which otherwise jitters the
    // right-aligned title horizontally and can flip the line-wrap vertically.
    const allChars = [];

    targets.forEach((host) => {
      if (host.dataset.scrambleReady === '1') return;
      host.dataset.scrambleReady = '1';

      const text = host.dataset.scrambleText || host.textContent || '';
      if (!text) return;

      host.classList.add('text-scramble');
      host.textContent = '';
      host.tabIndex = 0;

      const row = document.createElement('span');
      row.className = 'text-scramble__row';
      // Group chars into word spans so multi-word titles wrap at spaces
      // (not mid-word) when the row is allowed to wrap; the space chars
      // themselves stay as direct row children (the wrap points). charEls
      // stays indexed per-character so the scramble loop is unchanged.
      const charEls = [];
      let word = null;
      for (let i = 0; i < text.length; i++) {
        const span = document.createElement('span');
        span.className = 'text-scramble__char';
        span.style.transitionDelay = (i * 10) + 'ms';
        span.textContent = text[i];
        if (text[i] === ' ') {
          span.classList.add('text-scramble__space');
          row.appendChild(span);
          word = null;
        } else {
          if (!word) {
            word = document.createElement('span');
            word.className = 'text-scramble__word';
            row.appendChild(word);
          }
          word.appendChild(span);
          allChars.push(span);
        }
        charEls.push(span);
      }

      const underline = document.createElement('span');
      underline.className = 'text-scramble__underline';
      const ulBase = document.createElement('span');
      ulBase.className = 'text-scramble__underline-base';
      const ulActive = document.createElement('span');
      ulActive.className = 'text-scramble__underline-active';
      underline.appendChild(ulBase);
      underline.appendChild(ulActive);

      const glow = document.createElement('span');
      glow.className = 'text-scramble__glow';

      host.appendChild(row);
      host.appendChild(underline);
      host.appendChild(glow);

      let timer = null;
      function scramble() {
        if (timer) clearInterval(timer);
        let frame = 0;
        const duration = text.length * FRAMES_PER_CHAR;
        timer = setInterval(() => {
          frame++;
          const progress     = frame / duration;
          const revealedLen  = Math.floor(progress * text.length);
          for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === ' ') {
              charEls[i].textContent = ' ';
              charEls[i].classList.remove('is-scrambling');
              continue;
            }
            if (i < revealedLen) {
              charEls[i].textContent = ch;
              charEls[i].classList.remove('is-scrambling');
            } else {
              charEls[i].textContent = CHARS.charAt(Math.floor(Math.random() * CHARS.length));
              charEls[i].classList.add('is-scrambling');
            }
          }
          if (frame >= duration) {
            clearInterval(timer);
            timer = null;
            for (let i = 0; i < text.length; i++) {
              charEls[i].textContent = text[i];
              charEls[i].classList.remove('is-scrambling');
            }
          }
        }, INTERVAL_MS);
      }

      host.addEventListener('mouseenter', scramble);
      host.addEventListener('focus',      scramble);
    });

    // Lock each char to its natural width (batched: clear → read → write to
    // avoid layout thrash). Re-run after fonts load and on resize, since the
    // title font-size is a vw-based clamp.
    const lockWidths = () => {
      if (!allChars.length) return;
      allChars.forEach((el) => { el.style.width = ''; });
      const widths = allChars.map((el) => el.getBoundingClientRect().width);
      allChars.forEach((el, i) => {
        if (widths[i] > 0) {
          el.style.width = widths[i] + 'px';
          el.style.textAlign = 'center';
        }
      });
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(lockWidths);
    } else {
      lockWidths();
    }
    let rzT = null;
    window.addEventListener('resize', () => {
      clearTimeout(rzT);
      rzT = setTimeout(lockWidths, 200);
    });
  }

  /* -------------------------------------------------------
     initTopo — fill the body + pinned-section topo SVGs with
     a full-height field of gentle, very subtle contour waves.
     The hand-written markup only covered a middle band, leaving
     the top/bottom of the large cream pins bare. Here we generate
     evenly stacked, parallel (non-crossing) wavy lines spanning
     the whole viewBox so the contour texture fills the entire
     page edge-to-edge. The existing <g> stroke + opacity is
     reused, so final visibility is still controlled by CSS.
     ------------------------------------------------------- */
  function initTopo() {
    const groups = document.querySelectorAll('.topo-bg > g, .pin-topo > g');
    if (!groups.length) return;
    const HW  = 480;             // half wavelength (viewBox units)
    const X0  = -260, X1 = 2060; // span beyond the 1600-wide viewBox
    const AMP = 55;              // wave amplitude
    const paths = [];
    let B = 8;                   // running baseline (top → bottom)
    for (let i = 0; B < 1200; i++) {
      let x = X0;
      let d = 'M' + x + ',' + B +
              ' Q' + (x + HW / 2) + ',' + (B - AMP) + ' ' + (x + HW) + ',' + B;
      x += HW;
      while (x < X1) { x += HW; d += ' T' + x + ',' + B; }
      paths.push('<path d="' + d + '"/>');
      // Gently varied vertical spacing → organic, never crossing
      // (each line is the same wave shape, only shifted down).
      B += 52 + Math.round(12 * Math.sin(i * 0.7));
    }
    const html = paths.join('');
    groups.forEach((g) => { g.innerHTML = html; });
  }

  /* -------------------------------------------------------
     initHeroSign — "writes on" the cursive signature behind the
     character once the intro loader finishes. Sweeps a clip-path
     inset from the right edge (left → right reveal, along the
     slanted baseline) with an easeOutCubic, the vanilla take on the
     text-effect component's stroke draw-on. JS-driven so the timing
     is frame-accurate and reliable.
     ------------------------------------------------------- */
  function initHeroSign() {
    const el = document.querySelector('.hero-sign');
    if (!el) return;
    const baseEl = document.getElementById('heroSignBase') || el;

    const wlEl = document.querySelector('.hero__welcome--left');
    const wrEl = document.querySelector('.hero__welcome--right');
    const ease = (t) => 1 - Math.pow(1 - t, 3);   // easeOutCubic
    // Right-edge clip wipe at reveal fraction `f` (0 = hidden, 1 = open).
    // Top/bottom/left pushed out negative so it never cuts descenders.
    const clipAt = (f) => 'inset(-30% ' + (100 - f * 105).toFixed(2) + '% -45% -3%)';
    const CLIP_OPEN = clipAt(1);

    if (reduceMotionMQ && reduceMotionMQ.matches) {
      baseEl.style.clipPath = CLIP_OPEN;
      if (wlEl) wlEl.style.clipPath = CLIP_OPEN;
      if (wrEl) wrEl.style.clipPath = CLIP_OPEN;
      return;
    }

    // ----- Welcome line: ONE continuous write-on that flows from
    // "Welcome To My" straight into "Portfolio Experience". The two
    // spans are split by width so a single eased progress sweeps both
    // at a continuous pen speed. Kicked off once the name is fully
    // written on. -----
    function writeWelcome() {
      if (!wlEl || !wrEl) return;
      const lw = wlEl.offsetWidth || 220;
      const rw = wrEl.offsetWidth || 360;
      const split = lw / (lw + rw);          // where the left text ends
      const DUR = 2200;
      const t0 = performance.now();
      function frame(now) {
        let p = (now - t0) / DUR;
        if (p < 0) p = 0; else if (p > 1) p = 1;
        const pos = ease(p);                 // fraction along the whole line
        if (pos <= split) {
          wlEl.style.clipPath = clipAt(pos / split);
          wrEl.style.clipPath = clipAt(0);
        } else {
          wlEl.style.clipPath = CLIP_OPEN;
          wrEl.style.clipPath = clipAt((pos - split) / (1 - split));
        }
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    // ----- Name handwriting draw-on. Each Dancing Script glyph is a
    // stroked path that self-draws via stroke-dashoffset (staggered
    // left-to-right, like handwriting) then inks in — the fill fades up
    // as the pen stroke thins to nothing. Replaces the old clip sweep.
    // The welcome line kicks once the name is ~halfway drawn so the two
    // overlap and cascade. -----
    let started = false;
    function startDraw() {
      if (started) return;
      started = true;
      const draw = document.getElementById('heroSignDraw');
      const strokes = draw
        ? Array.prototype.slice.call(draw.querySelectorAll('.hero-sign__stroke'))
        : [];
      if (!strokes.length || typeof strokes[0].getTotalLength !== 'function') {
        // Fallback (SVG missing / no getTotalLength): show the static name.
        baseEl.style.clipPath = CLIP_OPEN;
        writeWelcome();
        return;
      }

      const DRAW = 620, STAGGER = 175, n = strokes.length;
      const total = DRAW + (n - 1) * STAGGER;

      // Hide each stroke (dash = full length) before revealing the SVG so
      // the formed outline never flashes. Driven by ONE rAF loop — same
      // approach as the welcome write-on, reliable everywhere and (unlike
      // WAAPI) not tied to the document timeline.
      const lengths = strokes.map((p) => {
        const L = p.getTotalLength();
        p.style.strokeDasharray = String(L);
        p.style.strokeDashoffset = String(L);
        return L;
      });
      draw.style.opacity = '1';

      const inked = new Array(n).fill(false);
      const drawEase = (t) => 1 - Math.pow(1 - t, 3);   // easeOutCubic
      const t0 = performance.now();
      let welcomeKicked = false;
      function frame(now) {
        const elapsed = now - t0;
        for (let i = 0; i < n; i++) {
          if (inked[i]) continue;
          const q = (elapsed - i * STAGGER) / DRAW;   // this letter's progress
          if (q <= 0) continue;
          if (q >= 1) {
            inked[i] = true;
            strokes[i].style.strokeDashoffset = '0';  // pin the drawn state
            strokes[i].style.fillOpacity = '1';       // ink this letter in
            strokes[i].style.strokeWidth = '0';       // pen thins to nothing
          } else {
            strokes[i].style.strokeDashoffset = String(lengths[i] * (1 - drawEase(q)));
          }
        }
        // Welcome line kicks once the name is ~halfway drawn.
        if (!welcomeKicked && elapsed >= total * 0.5) { welcomeKicked = true; writeWelcome(); }
        if (elapsed < total + 80) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    // Trigger once the loader has removed .is-pre-load (the hero is
    // revealed). If that already happened, go now.
    if (!document.body.classList.contains('is-pre-load')) {
      startDraw();
    } else {
      const mo = new MutationObserver(() => {
        if (!document.body.classList.contains('is-pre-load')) {
          mo.disconnect();
          startDraw();
        }
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { if (!started) startDraw(); }, 9000);  // safety net
    }

    // ----- Hover spotlight ("morphing cursor") reveal -----
    // An ink circle follows the cursor over the name; inside it,
    // "software engineer" shows in cream, counter-translated so it
    // stays fixed and is revealed through the moving window. Vanilla
    // port of the morphing-cursor component.
    const lens  = document.getElementById('heroSignLens');
    const inner = document.getElementById('heroSignLensInner');
    if (lens && inner) {
      // Starfield on a SINGLE <canvas>, drawn only while hovering — 999
      // twinkling dots without 999 animated DOM layers, so there's zero
      // cost during normal browsing (this was the jank source).
      const starsCanvas = document.getElementById('heroSignLensStars');
      const sctx  = starsCanvas ? starsCanvas.getContext('2d') : null;
      const stars = [];
      if (sctx) {
        for (let i = 0; i < 999; i++) {
          stars.push({
            nx: Math.random(), ny: Math.random(),  // normalized position
            r:  Math.random() * 1.1 + 0.4,          // 0.4–1.5px
            a:  Math.random() * 0.55 + 0.45,        // base alpha
            ph: Math.random() * 6.2832,             // twinkle phase
            sp: Math.random() * 0.0022 + 0.0008     // twinkle speed
          });
        }
      }
      let starsRaf = 0;
      function sizeStars() {
        if (!starsCanvas) return;
        const w = starsCanvas.offsetWidth, h = starsCanvas.offsetHeight;
        if (w && (starsCanvas.width !== w || starsCanvas.height !== h)) {
          starsCanvas.width = w; starsCanvas.height = h;
        }
      }
      function drawStars(now) {
        if (!sctx) { starsRaf = 0; return; }
        const w = starsCanvas.width, h = starsCanvas.height;
        sctx.clearRect(0, 0, w, h);
        sctx.fillStyle = '#F2EEE5';
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          sctx.globalAlpha = s.a * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * s.sp + s.ph)));
          sctx.beginPath();
          sctx.arc(s.nx * w, s.ny * h, s.r, 0, 6.2832);
          sctx.fill();
        }
        sctx.globalAlpha = 1;
        starsRaf = requestAnimationFrame(drawStars);
      }

      const TILT = -8 * Math.PI / 180;   // matches the CSS rotate(-8deg)
      const cosT = Math.cos(TILT), sinT = Math.sin(TILT);
      const target = { x: 0, y: 0 };
      const cur    = { x: 0, y: 0 };
      let hovering = false;
      let lraf = 0;
      const lensText = document.getElementById('heroSignLensText');
      // The reveal text is wider than the name, so its ends sit beyond
      // the cursor's reach. We map the cursor's travel across the name
      // (width sw) onto the full reveal-text width (tw) so sweeping
      // left→right reaches the first AND last letters. revealRatio =
      // tw/sw; the text scrolls under the lens at that ratio.
      let revealRatio = 1;

      // Cursor → the signature's LOCAL (un-rotated) frame. The element
      // is rotated by TILT, so we inverse-rotate the centered vector.
      function toLocal(clientX, clientY) {
        const r = el.getBoundingClientRect();
        const dx = clientX - (r.left + r.width  / 2);
        const dy = clientY - (r.top  + r.height / 2);
        return {
          x:  dx * cosT + dy * sinT + el.offsetWidth  / 2,
          y: -dx * sinT + dy * cosT + el.offsetHeight / 2
        };
      }
      function lensTick() {
        cur.x += (target.x - cur.x) * 0.15;
        cur.y += (target.y - cur.y) * 0.15;
        lens.style.transform =
          'translate(' + cur.x.toFixed(1) + 'px,' + cur.y.toFixed(1) + 'px) translate(-50%, -50%)';
        inner.style.transform =
          'translate(' + (-cur.x).toFixed(1) + 'px,' + (-cur.y).toFixed(1) + 'px)';
        // Scroll the reveal text under the lens at revealRatio so the
        // cursor's range covers its whole width (ends included). Stars
        // stay put (they ride the inner's plain counter-translate).
        if (lensText) {
          lensText.style.transform =
            'translate(' + (cur.x * (1 - revealRatio)).toFixed(1) + 'px, 0)';
        }
        if (hovering ||
            Math.abs(target.x - cur.x) > 0.4 || Math.abs(target.y - cur.y) > 0.4) {
          lraf = requestAnimationFrame(lensTick);
        } else { lraf = 0; }
      }
      el.addEventListener('mouseenter', (e) => {
        const p = toLocal(e.clientX, e.clientY);
        target.x = cur.x = p.x;
        target.y = cur.y = p.y;
        hovering = true;
        inner.style.width  = el.offsetWidth  + 'px';
        inner.style.height = el.offsetHeight + 'px';
        // Measure name width (cursor reach) vs reveal-text width so the
        // sweep maps onto the full text (first/last letters reachable).
        const sw = el.offsetWidth, tw = lensText ? lensText.offsetWidth : 0;
        revealRatio = (sw > 0 && tw > 0) ? tw / sw : 1;
        // Lens scales with the name's font size so it reveals roughly
        // full-height letters of the same-size "Software Engineer".
        const fs = parseFloat(getComputedStyle(el).fontSize) || 280;
        const lensSize = Math.round(fs * 1.25);
        lens.style.width = lens.style.height = lensSize + 'px';
        if (!lraf) lraf = requestAnimationFrame(lensTick);
        sizeStars();
        if (sctx && !starsRaf) starsRaf = requestAnimationFrame(drawStars);
      });
      el.addEventListener('mousemove', (e) => {
        const p = toLocal(e.clientX, e.clientY);
        target.x = p.x;
        target.y = p.y;
        if (!lraf) lraf = requestAnimationFrame(lensTick);
      });
      el.addEventListener('mouseleave', () => {
        hovering = false;
        lens.style.width = lens.style.height = '0px';
        if (starsRaf) { cancelAnimationFrame(starsRaf); starsRaf = 0; }
      });
    }
  }

  /* -------------------------------------------------------
     initWelcomeBreath — the weight-breath on the bottom line is pure
     CSS now (a single faux-bold text-shadow per line; see
     .hero__welcome--left/right). There's no stacked bold copy, so no
     double-image ghosting. This only wires the IntersectionObserver
     that pauses that CSS animation while the hero is off screen.
     ------------------------------------------------------- */
  function initWelcomeBreath() {
    const heroSec = document.getElementById('hero');
    if (heroSec && 'IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        const visible = entries[0].isIntersecting;
        document.body.classList.toggle('hero-hidden', !visible);
        // Gate the cinema reel: suspend it entirely while the hero is
        // off-screen, resume (and repaint) on re-entry.
        motion.heroVisible = visible;
        if (visible) kickMotion();
      }).observe(heroSec);
    }
  }

  /* -------------------------------------------------------
     Adaptive frame-rate fallback.
     The probe must sample the REAL heavy phase — the character
     reel running over the ambient effects — so it is armed at
     init() but only fired from startHeroReel() (i.e. AFTER the
     preloader hands off; measuring during the light preloader
     phase would under-read the load). If the device can't sustain
     a smooth rate, switch to perf-lite, which freezes the always-on
     decorative animations (see styles.css .perf-lite) — the ambient
     repaint, not the character reel, is the bottleneck. ?lite=1/0
     forces the decision.
     ------------------------------------------------------- */
  let perfProbeArmed = false;
  let perfProbeRan = false;

  function initPerfProbe() {
    const liteParam = new URLSearchParams(location.search).get('lite');
    if (liteParam === '1') { document.body.classList.add('perf-lite'); return; }
    if (liteParam === '0') return;   // forced off — never arm
    perfProbeArmed = true;
  }

  function runPerfProbe() {
    if (!perfProbeArmed || perfProbeRan) return;
    perfProbeRan = true;

    const SETTLE = 900;    // skip the reel's own start-up burst
    const SAMPLE = 1600;   // measure over this window
    const THRESH = 50;     // sustained FPS below this → go lite

    setTimeout(() => {
      if (document.hidden) { perfProbeRan = false; return; }  // can't judge a hidden tab; allow a later retry
      let frames = 0;
      const start = performance.now();
      function count(now) {
        frames++;
        if (now - start < SAMPLE) { requestAnimationFrame(count); return; }
        const fps = (frames / (now - start)) * 1000;
        if (fps < THRESH) document.body.classList.add('perf-lite');
      }
      requestAnimationFrame(count);
    }, SETTLE);
  }

  /* -------------------------------------------------------
     initTerminal — vanilla port of the shadcn "Terminal".
     Types each command character-by-character with bash
     syntax highlighting, prints its outputs, then advances to
     the next; starts when scrolled into view. Config (commands,
     outputs, speeds) lives in the .term__config JSON in the
     markup. Keyboard audio from the original is intentionally
     dropped (no sound asset). Reduced motion renders instantly.
     ------------------------------------------------------- */
  function initTerminal() {
    const root = document.querySelector('[data-terminal]');
    if (!root) return;
    const screen = root.querySelector('.term__screen');
    const cfgEl = root.querySelector('.term__config');
    if (!screen || !cfgEl) return;
    let cfg;
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }

    const commands = cfg.commands || [];
    const outputs = cfg.outputs || {};
    const typingSpeed = cfg.typingSpeed || 50;
    const delayBetween = cfg.delayBetweenCommands || 800;
    const initialDelay = cfg.initialDelay || 500;
    const username = cfg.username || 'guest';

    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const PROMPT =
      '<span class="term__u">' + esc(username) + '</span>' +
      '<span class="term__c">:</span><span class="term__tilde">~</span>' +
      '<span class="term__d">$</span> ';
    const CURSOR = '<span class="term__cursor"></span>';

    // Port of tokenizeBash: classify each whitespace-split word.
    function tokenize(text) {
      const out = [];
      let first = true;
      text.split(/(\s+)/).forEach((w) => {
        if (w === '') return;
        if (/^\s+$/.test(w)) { out.push(['default', w]); return; }
        if (w.startsWith('#')) { out.push(['comment', w]); return; }
        if (w.startsWith('$')) { out.push(['variable', w]); first = false; return; }
        if (w.startsWith('-')) { out.push(['flag', w]); first = false; return; }
        if (/^["'].*["']$/.test(w)) { out.push(['string', w]); first = false; return; }
        if (/^\d+$/.test(w)) { out.push(['number', w]); first = false; return; }
        if (/^[|>&<]+$/.test(w)) { out.push(['operator', w]); first = true; return; }
        if (w.indexOf('/') !== -1 || w.startsWith('.') || w.startsWith('~')) {
          out.push(['path', w]); first = false; return;
        }
        if (first) { out.push(['command', w]); first = false; return; }
        out.push(['default', w]);
      });
      return out;
    }
    const highlight = (text) => tokenize(text)
      .map(([type, val]) => '<span class="t-' + type + '">' + esc(val) + '</span>')
      .join('');

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    function addLine(html) {
      const d = document.createElement('div');
      d.className = 'term__line';
      d.innerHTML = html;
      screen.appendChild(d);
      screen.scrollTop = screen.scrollHeight;
      return d;
    }
    const outsFor = (i) => outputs[i] || outputs[String(i)] || [];

    async function run() {
      // Reduced motion: print the whole session at once, no typing.
      if (reduceMotionMQ && reduceMotionMQ.matches) {
        commands.forEach((cmd, ci) => {
          addLine(PROMPT + highlight(cmd));
          outsFor(ci).forEach((o) => addLine('<span class="term__out">' + esc(o) + '</span>'));
        });
        addLine(PROMPT + CURSOR);
        return;
      }
      await sleep(initialDelay);
      for (let ci = 0; ci < commands.length; ci++) {
        const cmd = commands[ci];
        const line = addLine(PROMPT + CURSOR);
        for (let k = 1; k <= cmd.length; k++) {
          line.innerHTML = PROMPT + highlight(cmd.slice(0, k)) + CURSOR;
          screen.scrollTop = screen.scrollHeight;
          await sleep(typingSpeed + Math.random() * 30);
        }
        line.innerHTML = PROMPT + highlight(cmd);     // commit, drop cursor
        const outs = outsFor(ci);
        for (let oi = 0; oi < outs.length; oi++) {
          await sleep(150);
          addLine('<span class="term__out">' + esc(outs[oi]) + '</span>');
        }
        if (ci < commands.length - 1) await sleep(delayBetween);
      }
      addLine(PROMPT + CURSOR);                        // idle prompt
    }

    let started = false;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !started) {
          started = true;
          io.disconnect();
          run();
        }
      }, { threshold: 0.25 });
      io.observe(root);
    } else {
      run();
    }
  }

  /* -------------------------------------------------------
     initTimeline — scroll-in animation for the experience
     timeline. Arms the CSS (.tl--anim hides items + collapses
     the rail), then adds .is-active when the timeline scrolls
     into view so the rail draws and the entries stagger in.
     Progressive enhancement: without JS the timeline is fully
     visible (no .tl--anim).
     ------------------------------------------------------- */
  function initTimeline() {
    const tl = document.querySelector('.tl');
    if (!tl) return;
    tl.classList.add('tl--anim');
    if (reduceMotionMQ && reduceMotionMQ.matches) {
      tl.classList.add('is-active');
      return;
    }
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          tl.classList.add('is-active');
          io.disconnect();
        }
      }, { threshold: 0.15 });
      io.observe(tl);
    } else {
      tl.classList.add('is-active');
    }
  }

  /* ------------------------------------------------------------
     initXpTimeline — cinematic neural timeline (rebuilt).
     Builds the zigzag "live wire" path in real pixels, plays a
     sequenced reveal (line draws → orbs pop → cards + content
     slide in), keeps the wire's energy flowing, activates each
     node as it enters the viewport, and wires up mouse parallax /
     cursor glow / orb proximity + a light particle field. Degrades
     to a clean static layout under reduced-motion / no-GSAP.
     ------------------------------------------------------------ */
  function initXpShowcase() {
    const xpx2 = document.querySelector('[data-xpx2]');
    if (!xpx2) return;
    const globe = document.getElementById('xpGlobe');
    const section = document.getElementById('experience');
    const panels = [...xpx2.querySelectorAll('[data-xpp]')];
    const pctEl = xpx2.querySelector('.xpx2__pct');
    const barEl = xpx2.querySelector('.xpx2__bar i');
    const sceneEl = xpx2.querySelector('.xpx2__scene');
    const dots = [...xpx2.querySelectorAll('.xpx2__dot')];
    const REVEAL = '.xpcard__num, .xpcard__title, .xpcard__sub, .xpcard__body, .xpcard__points';

    // Light the globe + HUD while the section is on screen, and pause the
    // globe\u2019s render loop (data-active) when it isn\u2019t — keeps it off the GPU
    // everywhere else on the page.
    const setGlobe = (on) => {
      xpx2.classList.toggle('is-on', on);
      if (!globe) return;
      clearTimeout(globe.__pauseT);
      if (on) {
        globe.setAttribute('data-active', '1');
      } else {
        globe.__pauseT = setTimeout(() => globe.setAttribute('data-active', '0'), 1300);
      }
    };
    if (typeof ScrollTrigger !== 'undefined' && section) {
      ScrollTrigger.create({
        trigger: section,
        start: 'top 30%',     // appears once the section mostly fills the view
        end: 'bottom 18%',    // powers down only as the whole section ends
        onToggle: (self) => setGlobe(self.isActive),
      });
    } else if ('IntersectionObserver' in window && section) {
      new IntersectionObserver((es) => setGlobe(es[0].isIntersecting), { threshold: 0 }).observe(section);
    } else {
      setGlobe(true);
    }

    // Per-panel reveal + active scene / dot.
    if ('IntersectionObserver' in window) {
      const ioReveal = new IntersectionObserver((es) => {
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.querySelectorAll(REVEAL).forEach((el) => el.classList.add('visible'));
            ioReveal.unobserve(e.target);
          }
        });
      }, { threshold: 0.28 });
      panels.forEach((p) => ioReveal.observe(p));

      const ioScene = new IntersectionObserver((es) => {
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          const i = panels.indexOf(e.target);
          if (sceneEl) sceneEl.textContent = e.target.getAttribute('data-scene') || '';
          dots.forEach((d, k) => d.classList.toggle('is-on', k === i));
        });
      }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
      panels.forEach((p) => ioScene.observe(p));
    } else {
      panels.forEach((p) => p.querySelectorAll(REVEAL).forEach((el) => el.classList.add('visible')));
    }

    // Scroll progress \u2192 HUD percentage + bar.
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.create({
        trigger: xpx2, start: 'top top', end: 'bottom bottom', invalidateOnRefresh: true,
        onUpdate: (self) => {
          const pct = Math.round(self.progress * 100);
          if (pctEl) pctEl.textContent = String(pct).padStart(3, '0') + '%';
          if (barEl) barEl.style.width = pct + '%';
        },
      });
    }

    // Intro CTA scrolls to the first role (native smooth scroll, no hijack).
    const cta = xpx2.querySelector('.xpcard__cta');
    if (cta) cta.addEventListener('click', (e) => {
      e.preventDefault();
      if (panels[1]) panels[1].scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  /* ------------------------------------------------------------
     initThemeShift — "lights off" dark mode.
     As the page scrolls past the project gallery into the
     experience section, flip html.is-dark on. The palette
     variables swap and the backdrop + experience/contact content
     fade light → dark over a short CSS transition. Scrolling back
     up past the boundary returns it to light. Discrete toggle
     (not scrubbed) so the fade reads as one clean, short sweep.
     ------------------------------------------------------------ */
  function initThemeShift() {
    if (typeof ScrollTrigger === 'undefined') return;
    const xp = document.getElementById('experience');
    if (!xp) return;
    const root = document.documentElement;
    const sweep = document.querySelector('.theme-sweep');
    const reduce = reduceMotionMQ && reduceMotionMQ.matches;

    // A glowing accent blade sweeps across the screen as the lights change —
    // downward when going dark, upward when coming back to light — so the
    // theme flip reads as a wave passing through, not a flat crossfade. The
    // staggered CSS colour transition morphs underneath it.
    const fireSweep = (dir) => {
      if (!sweep || reduce || typeof gsap === 'undefined') return;
      gsap.killTweensOf(sweep);
      gsap.fromTo(sweep,
        { yPercent: dir > 0 ? -120 : 120, opacity: 1 },
        { yPercent: dir > 0 ? 120 : -120, duration: 1.05, ease: 'power2.inOut',
          onComplete: () => gsap.set(sweep, { opacity: 0 }) });
    };

    const setDark = (on) => root.classList.toggle('is-dark', on);

    // Dark mode is scoped to the experience section: the lights come on as you
    // enter it and go back OFF once it's done — each crossing plays the same
    // accent-blade sweep, always travelling in the scroll direction.
    ScrollTrigger.create({
      trigger: xp,
      start: 'top 85%',      // entering the section (leaving the gallery)
      end: 'bottom 15%',     // the section is done (heading into contact)
      invalidateOnRefresh: true,
      onEnter:     () => { setDark(true);  fireSweep(1); },   // scroll down in  → dark
      onLeaveBack: () => { setDark(false); fireSweep(-1); },  // scroll up out   → light
      onLeave:     () => { setDark(false); fireSweep(1); },   // scroll down out → light
      onEnterBack: () => { setDark(true);  fireSweep(-1); },  // scroll up in    → dark
    });
  }

  /* ------------------------------------------------------------
     initXpFrame — scroll-drawn frame around the experience page.
     Two symmetric half-strokes (left + right) start at the top
     centre, run out to the corners, down both sides and close at
     the bottom centre. The draw is scrubbed to the section's own
     scroll, so the line travels corner-to-corner as you move down
     the page — the gallery's diagonal "continuing" to wrap this
     section in a blueprint frame. Accent L-brackets snap on as each
     corner is reached and a small accent spark leads each drawing
     head. The frame itself is shown only in dark mode (CSS).
     ------------------------------------------------------------ */
  function initXpFrame() {
    if (typeof ScrollTrigger === 'undefined') return;
    const xp = document.getElementById('experience');
    const frame = xp && xp.querySelector('.xp__frame');
    if (!frame) return;
    const pathR  = frame.querySelector('.xp__frame-path--r');
    const pathL  = frame.querySelector('.xp__frame-path--l');
    const sparkR = frame.querySelector('.xp__frame-spark--r');
    const sparkL = frame.querySelector('.xp__frame-spark--l');
    const corners = {
      tl: frame.querySelector('.xp__frame-corner--tl'),
      tr: frame.querySelector('.xp__frame-corner--tr'),
      br: frame.querySelector('.xp__frame-corner--br'),
      bl: frame.querySelector('.xp__frame-corner--bl'),
    };
    if (!pathR || !pathL) return;
    const svg = frame.querySelector('.xp__frame-svg');

    let lenR = 0, lenL = 0, boxW = 0, boxH = 0, curP = 0, topAt = 0.25, botAt = 0.95;
    const INSET = 1.5;

    // Build the two half-paths in REAL pixel coords with a 1:1 viewBox. The
    // frame box is non-square, so a fixed square viewBox (stretched via
    // preserveAspectRatio="none") makes the non-scaling-stroke dash measure in
    // a different scale than getTotalLength — which left the final (bottom)
    // segment permanently in the dash "gap", i.e. never drawn, giving a
    // U-shaped frame. Matching px coords fixes that and keeps the stroke an
    // even width on every side.
    function buildPaths() {
      boxW = svg.clientWidth;
      boxH = svg.clientHeight;
      if (!boxW || !boxH) return;
      svg.setAttribute('viewBox', '0 0 ' + boxW + ' ' + boxH);
      const i = INSET, mx = boxW / 2, r = boxW - i, bt = boxH - i;
      // Right half: bottom-centre → bottom-right → up → top-centre.
      pathR.setAttribute('d', 'M ' + mx + ' ' + bt + ' L ' + r + ' ' + bt + ' L ' + r + ' ' + i + ' L ' + mx + ' ' + i);
      // Left half: bottom-centre → bottom-left → up → top-centre.
      pathL.setAttribute('d', 'M ' + mx + ' ' + bt + ' L ' + i + ' ' + bt + ' L ' + i + ' ' + i + ' L ' + mx + ' ' + i);
      lenR = pathR.getTotalLength();
      lenL = pathL.getTotalLength();
      pathR.style.strokeDasharray = lenR;
      pathL.style.strokeDasharray = lenL;
      // Corner-lit thresholds follow the actual segment proportions — the
      // draw now originates at the bottom, so the bottom corners are reached
      // first and the top corners last.
      const half = mx - i, side = bt - i;
      botAt = half / lenR;
      topAt = (half + side) / lenR;
      draw(curP);
    }

    const place = (spark, path, len, p) => {
      const pt = path.getPointAtLength(p * len);
      spark.style.left = (pt.x / boxW * 100) + '%';
      spark.style.top  = (pt.y / boxH * 100) + '%';
    };

    function draw(p) {
      curP = p;
      pathR.style.strokeDashoffset = lenR * (1 - p);
      pathL.style.strokeDashoffset = lenL * (1 - p);
      const drawing = p > 0.002 && p < 0.998;
      frame.classList.toggle('is-drawing', drawing);
      if (drawing) {
        place(sparkR, pathR, lenR, p);
        place(sparkL, pathL, lenL, p);
      }
      corners.tl.classList.toggle('is-lit', p >= topAt);
      corners.tr.classList.toggle('is-lit', p >= topAt);
      corners.br.classList.toggle('is-lit', p >= botAt);
      corners.bl.classList.toggle('is-lit', p >= botAt);
    }

    // Exit erase — removes the frame from the BOTTOM up, so the animation ENDS
    // at the top (a continuation of the upward sweep rather than a reverse).
    // q: 0 = full frame, 1 = gone. Negative dashoffset anchors the visible
    // span at the top end and walks the erase head up from the bottom.
    function drawExit(q) {
      pathR.style.strokeDashoffset = -(lenR * q);
      pathL.style.strokeDashoffset = -(lenL * q);
      const erasing = q > 0.002 && q < 0.998;
      frame.classList.toggle('is-drawing', erasing);
      if (erasing) {
        place(sparkR, pathR, lenR, q);
        place(sparkL, pathL, lenL, q);
      }
      // Each corner stays lit until the rising erase head passes it — bottom
      // corners go dark first, the top corners last.
      corners.bl.classList.toggle('is-lit', botAt >= q);
      corners.br.classList.toggle('is-lit', botAt >= q);
      corners.tl.classList.toggle('is-lit', topAt >= q);
      corners.tr.classList.toggle('is-lit', topAt >= q);
    }

    buildPaths();
    window.addEventListener('resize', buildPaths);

    if (reduceMotionMQ && reduceMotionMQ.matches) { draw(1); return; }

    draw(0);

    // Visibility spans the frame's whole presence — from the moment we begin
    // leaving the gallery (lights go off) until the experience section has
    // fully scrolled past.
    ScrollTrigger.create({
      trigger: xp,
      start: 'top 85%',
      end: 'bottom top',
      invalidateOnRefresh: true,
      onToggle: (self) => frame.classList.toggle('xp__frame--active', self.isActive),
    });

    // ENTRANCE — the frame draws itself ON right after the screen turns dark
    // (the dark flip fires at 'top 85%', so the draw begins just after, at
    // 'top 75%') and is fully complete by the time the experience page fills
    // the viewport ('top top').
    ScrollTrigger.create({
      trigger: xp,
      start: 'top 75%',
      end: 'top top',
      invalidateOnRefresh: true,
      onUpdate: (self) => draw(self.progress),
      onLeave: () => draw(1),        // settle complete for the hold
      onLeaveBack: () => draw(0),    // scrolled back above → cleared
    });

    // HOLD — between 'top top' and 'bottom bottom' neither entrance nor exit
    // is active, so the frame simply stays fully drawn the entire time the
    // experience page is in view.

    // EXIT — as the section scrolls away the frame erases from the bottom up,
    // so the animation ENDS at the top ('bottom bottom' = fully read →
    // 'bottom top' = section gone).
    ScrollTrigger.create({
      trigger: xp,
      start: 'bottom bottom',
      end: 'bottom top',
      invalidateOnRefresh: true,
      onUpdate: (self) => drawExit(self.progress),
      onLeaveBack: () => draw(1),    // back up into the hold → full again
      onLeave: () => drawExit(1),    // fully past → erased (ended at top)
    });
  }

  function init() {
    // Always start the experience from the top so the intro
    // loader and hero reel run cleanly. Disable browser scroll
    // restoration; force scrollY = 0 once before anything else
    // measures layout.
    if ('scrollRestoration' in history) {
      try { history.scrollRestoration = 'manual'; } catch (e) {}
    }
    window.scrollTo(0, 0);

    // Belt-and-suspenders so a reload from ANY section lands on the hero with
    // the full intro: re-assert the top after the load event (defeats any late
    // browser scroll-restore), and on back/forward-cache restore reload the
    // page so the whole intro replays instead of showing a frozen mid-page.
    // (Skipped when the ?scroll debug param is positioning the page.)
    if (!new URLSearchParams(location.search).has('scroll')) {
      const toTop = () => window.scrollTo(0, 0);
      window.addEventListener('load', () => { toTop(); requestAnimationFrame(toTop); });
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) { location.reload(); return; }
        toTop();
      });
    }

    // Initial canvas sizing right away so first frame fills.
    sizeCanvas(cinemaCanvas);
    refreshHeroLayout();        // cache scrollShift + pinRect once

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

    initTopo();
    initHeroSign();
    initWelcomeBreath();
    initBlurAside();
    initReveals();
    initStatCounters();
    initScrollProgress();
    initCursorParallax();
    initSkillsWarp();

    // Wire up GSAP ScrollTriggers BEFORE we start preloading so
    // the very first scroll already gets the smooth scrub.
    // initScrollTriggers now ONLY registers handlers — the hero
    // reel kick is deferred to startHeroReel(), invoked by the
    // intro loader's onComplete.
    initScrollTriggers();

    // Projects gallery LAST: its pinned ScrollTrigger sits at the
    // bottom of the page, so creating it after the hero/skills
    // triggers keeps refresh order top-to-bottom (per GSAP guidance).
    initProjectsHall();

    // Wrap each project description's words for the hover-decrypt
    // effect (vanilla port of hyper-text-with-decryption.tsx).
    initHyperText();

    // Build the per-character scramble titles in the gallery
    // (vanilla port of text-scramble.tsx).
    initTextScramble();

    // Self-typing terminal in the experience section (left of the timeline).
    initTerminal();

    // Data-globe experience showcase.
    initXpShowcase();

    // Light → dark "lights off" theme flip at the gallery→experience boundary.
    initThemeShift();

    // Scroll-drawn blueprint frame that wraps the experience page.
    initXpFrame();

    // Paint frame 0 right away so the hero never looks empty.
    renderFrame(0, false);

    // Play the first-paint reveal. When the loader timeline
    // finishes, it calls startHeroReel() to wake the cinema
    // reel. If GSAP / loader element are missing, the loader
    // skips itself and startHeroReel() runs immediately.
    initPreloader();

    // Preload frames in priority order. When the full set is in
    // memory, force a redraw and tell ScrollTrigger to recompute
    // start/end (in case image-driven layout shifted anything).
    preloadAll().then(() => {
      lastDrawnFrame = -1;
      renderFrame(frameState.idx, false);
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
    });

    window.addEventListener('resize', onResize);

    // Suspend the hero reel while the tab is backgrounded (browsers
    // already throttle rAF, but this also stops the reel's auto-advance
    // cleanly); resume + repaint on return.
    document.addEventListener('visibilitychange', () => {
      motion.pageVisible = !document.hidden;
      if (motion.pageVisible) kickMotion();
    });

    // Adaptive: drop to perf-lite if this device can't keep up.
    initPerfProbe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
