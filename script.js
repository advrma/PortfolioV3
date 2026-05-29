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
  const STEP = 1;                  // every source frame — needed so adjacent
                                   // rAF ticks paint *different* poses, which
                                   // is what the canvas-accumulation motion
                                   // blur relies on for a visible smear.
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

  /* Draw the character sharply — one source frame at full alpha
     per tick. No blending, no fading, no flicker.
     The high source-frame density (STEP = 1 → 300 frames) gives
     ~16 fps source playback at BASE_RATE = 0.25, which already
     looks smooth without any cross-fade trickery that would
     soften the character.
     xCrop = 0.6 ignores transparent gutters in the source PNGs. */
  function renderFrame(idx, _advancing) {
    const max = FRAME_COUNT - 1;
    let i = Math.round(+idx || 0);
    if (i < 0) i = 0;
    else if (i > max) i = max;
    if (i === lastDrawnFrame) return;
    lastDrawnFrame = i;
    const img = images[i] || nearestLoaded(i);
    drawImageContain(cinemaCtx, cinemaCanvas, img, 0.6);
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
    running: false
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
  const BASE_RATE      = 0.25;      // virtual frames/tick ≈ 5.5 source-fps — super slow cinematic crawl
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
    // --- Decide whether to advance this tick, and which way ---
    //   INTRO branch (!hasScrolled): forward only, after delay,
    //     until animFrame hits HOLD_FRAME.
    //   MAIN branch  (hasScrolled):  step in playDirection while
    //     runway exists in that direction.
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
      shouldAdvance = true;
      advanceStep = BASE_RATE;
    } else if (motion.playDirection === -1 && motion.animFrame > HOLD_FRAME) {
      // Reverse only as far back as HOLD_FRAME (the intro hold
      // pose). Once you've left the intro, reversing brings the
      // reel back to the HOLD pose but never further — the
      // 0→80 intro autoplay is a one-shot, not a rewind target.
      shouldAdvance = true;
      advanceStep = -BASE_RATE;
    } else {
      shouldAdvance = false;
    }

    if (shouldAdvance) {
      motion.animFrame += advanceStep;
      if (motion.animFrame > TIMELINE_MAX) motion.animFrame = TIMELINE_MAX;
      // Lower clamp only applies after the user has crossed
      // HOLD_FRAME (i.e., in MAIN). During INTRO autoplay
      // animFrame is between 0 and HOLD_FRAME, which must NOT
      // be snapped back up.
      else if (motion.hasScrolled && motion.animFrame < HOLD_FRAME) {
        motion.animFrame = HOLD_FRAME;
      }
    }

    // --- Auto-scroll the page in sync with animFrame ---
    // Once MAIN is active, scrollY tracks animFrame linearly
    // across the pin runway, so the page progresses through
    // the hero at the same cadence as the animation and the
    // skills section appears exactly as the reel ends.
    if (shouldAdvance && motion.hasScrolled && motion.pinRunway > 0) {
      const mainProgress =
        (motion.animFrame - HOLD_FRAME) / (TIMELINE_MAX - HOLD_FRAME);
      const targetScrollY =
        motion.heroSectionTop + clamp01(mainProgress) * motion.pinRunway;
      if (Math.abs(window.scrollY - targetScrollY) > 0.5) {
        isAutoScrolling = true;
        window.scrollTo(0, targetScrollY);
        isAutoScrolling = false;
      }
    }

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
  }

  /* -------------------------------------------------------
     initIntroLoader — willem-style GSAP timeline.
     Sequence:
       1. ADI / TYA letters slide up
       2. Box opens; growing image inside fills the box
       3. Heading halves shift slightly to mark the opening
       4. Three character-pose covers flicker out in stagger
       5. Image expands to full viewport (ink-dark backdrop)
       6. Box widens to 110vw to keep things visually flush
       7. White bottom mark + top nav text slide up
       8. Brief hold, then GSAP fades the loader and calls finish.
     Falls back to a safety timer if GSAP isn't available.
     ------------------------------------------------------- */
  function initIntroLoader() {
    const loader = document.getElementById('introLoader');
    if (!loader) {
      startHeroReel();
      return;
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let done = false;
    function finishLoader() {
      if (done) return;
      done = true;
      loader.classList.add('is--gone');
      document.body.classList.remove('is-pre-load');
      document.body.style.overflow = prevOverflow;
      startHeroReel();
    }

    // Absolute safety — never let the user get stuck on the loader.
    const safety = setTimeout(finishLoader, 9000);

    if (typeof gsap === 'undefined') {
      // No GSAP → snap finish. The safety timer above also handles
      // it, but call sooner so the user doesn't wait 9 s.
      clearTimeout(safety);
      setTimeout(finishLoader, 400);
      return;
    }

    try {
      const letters     = loader.querySelectorAll('.intro-loader__letter');
      const box         = loader.querySelectorAll('.intro-loader__box');
      const growing     = loader.querySelectorAll('.intro-loader__growing');
      const headStart   = loader.querySelectorAll('.intro-loader__h1-start');
      const headEnd     = loader.querySelectorAll('.intro-loader__h1-end');
      const covers      = loader.querySelectorAll('.intro-loader__cover');
      const whiteMark   = loader.querySelectorAll('.intro-loader__letter-white');
      const navLinks    = loader.querySelectorAll('.intro-loader__navlink, .intro-loader__credits');

      // Lock initial states explicitly so paint-timing doesn't
      // matter (matches the `from` values in the willem reference).
      if (letters.length)   gsap.set(letters,   { yPercent: 100 });
      if (whiteMark.length) gsap.set(whiteMark, { yPercent: 100 });
      if (navLinks.length)  gsap.set(navLinks,  { yPercent: 100 });

      const tl = gsap.timeline({
        defaults: { ease: 'expo.inOut' },
        onComplete: () => {
          clearTimeout(safety);
          // GSAP-driven fade so the timing is in our hands.
          gsap.to(loader, {
            opacity: 0,
            duration: 0.6,
            ease: 'power2.out',
            onComplete: finishLoader
          });
        }
      });

      // 1. ADI / TYA letters slide up
      tl.to(letters, { yPercent: 0, stagger: 0.025, duration: 1.0 });

      // 2. Box opens between them; growing image fills it
      tl.fromTo(box,
        { width: '0em' },
        { width: '1em', duration: 1.0 },
        '< 1.0');
      tl.fromTo(growing,
        { width: '0%' },
        { width: '100%', duration: 1.0 },
        '<');

      // 3. Heading halves shift outward subtly
      tl.fromTo(headStart, { x: '0em' }, { x: '-0.05em', duration: 1.0 }, '<');
      tl.fromTo(headEnd,   { x: '0em' }, { x:  '0.05em', duration: 1.0 }, '<');

      // 4. Cover layers flicker out (each visible briefly)
      tl.to(covers, {
        opacity: 0, duration: 0.05, ease: 'none', stagger: 0.4
      }, '>-=0.05');

      // 5. Growing image expands to full viewport
      tl.to(growing, {
        width: '100vw', height: '100vh', duration: 1.6
      }, '>-=0.1');
      tl.to(box, { width: '110vw', duration: 1.6 }, '<');

      // 6. White ADITYA mark slides up + nav text slides up
      tl.to(whiteMark, {
        yPercent: 0, duration: 1.0, ease: 'expo.out', stagger: 0.035
      }, '<+=0.7');
      tl.to(navLinks, {
        yPercent: 0, duration: 1.0, ease: 'expo.out', stagger: 0.08
      }, '<');

      // 7. Brief hold on the composed final shot before fade-out
      tl.to({}, { duration: 0.7 });
    } catch (err) {
      clearTimeout(safety);
      setTimeout(finishLoader, 500);
      // eslint-disable-next-line no-console
      console.error('[intro-loader] timeline failed:', err);
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

      // Item transforms — single pass through the world.
      const t = time * 0.001;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const vizZ = item.baseZ + state.cameraZ;

        // Opacity envelope: fade in from far, hold, fade out when past camera.
        // The past-camera fade-out range is wide (1600 units) so several
        // recent items remain partially visible behind the current one —
        // no more "single lonely card" frames at the end of the section.
        // Stars use full element opacity so their per-star baseAlpha
        // (set inline at creation) is what controls visible brightness.
        let alpha;
        if (vizZ < -3200)      alpha = 0;
        else if (vizZ < -2200) alpha = (vizZ + 3200) / 1000;
        else if (vizZ > 80 && item.type !== 'star') alpha = Math.max(0, 1 - (vizZ - 80) / 1600);
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

    const SLIDE_COUNT = 4;
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
      'https://images.unsplash.com/photo-1535378917042-10a22c95931a?w=900&q=80',
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=900&q=80'
    ];

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_HEX);
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
    const mouse       = { x: 0, y: 0 };
    let visible       = false;
    let raf           = 0;

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
      if (!visible) return;
      // currentScroll mirrors targetScroll, which is driven by the
      // gotoIndex() GSAP tween — that tween is the single source of
      // eased motion, so a band crossing glides to the next project
      // in one continuous motion (no per-frame LERP double-smoothing).
      currentScroll = targetScroll;

      const xMove = currentScroll * Math.cos(WALL_ANGLE);
      const zMove = currentScroll * Math.sin(WALL_ANGLE);
      camera.position.x = xMove;
      camera.position.z = CAM_Z - zMove;

      camera.rotation.x = mouse.y * 0.04;
      camera.rotation.y = -mouse.x * 0.04;

      updateUI(currentScroll);
      renderer.render(scene, camera);
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

    // Camera glide: animate the camera's horizontal position to a
    // discrete project index in one continuous motion.
    const camState = { scroll: 0 };
    let activeIndex = 0;
    let camTween = null;
    function glideTo(i) {
      if (i < 0) i = 0;
      else if (i > SLIDE_COUNT - 1) i = SLIDE_COUNT - 1;
      if (i === activeIndex) return;
      activeIndex = i;
      if (camTween) camTween.kill();
      camTween = gsap.to(camState, {
        scroll: i * SPACING_X,
        duration: 0.7,
        ease: 'power3.inOut',
        onUpdate: () => { targetScroll = camState.scroll; kickRender(); }
      });
    }

    // ----- Free-scroll discrete paging -----
    // The page scroll is NEVER locked or hijacked, so the section can
    // never trap you — you can always scroll up or down freely. As you
    // scroll through the section, the scroll progress is quantized to
    // the nearest project index and the camera glides there in one
    // smooth motion. The section releases to the next section naturally.
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom bottom',
        invalidateOnRefresh: true,
        onEnter:     () => { visible = true;  kickRender(); },
        onEnterBack: () => { visible = true;  kickRender(); },
        onLeave:     () => { visible = false; },
        onLeaveBack: () => { visible = false; },
        onUpdate: (self) => {
          glideTo(Math.round(self.progress * (SLIDE_COUNT - 1)));
        }
      });
    }
  }

  /* -------------------------------------------------------
     INIT
     ------------------------------------------------------- */
  function init() {
    // Always start the experience from the top so the intro
    // loader and hero reel run cleanly. Disable browser scroll
    // restoration; force scrollY = 0 once before anything else
    // measures layout.
    if ('scrollRestoration' in history) {
      try { history.scrollRestoration = 'manual'; } catch (e) {}
    }
    window.scrollTo(0, 0);

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

    // Paint frame 0 right away so the hero never looks empty.
    renderFrame(0, false);

    // Play the first-paint reveal. When the loader timeline
    // finishes, it calls startHeroReel() to wake the cinema
    // reel. If GSAP / loader element are missing, the loader
    // skips itself and startHeroReel() runs immediately.
    initIntroLoader();

    // Preload frames in priority order. When the full set is in
    // memory, force a redraw and tell ScrollTrigger to recompute
    // start/end (in case image-driven layout shifted anything).
    preloadAll().then(() => {
      lastDrawnFrame = -1;
      renderFrame(frameState.idx, false);
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
