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

  /* -------------------------------------------------------
     BOOT READINESS ORCHESTRATION
     The intro curtain now lifts only when the site is actually ready:
     reel frames + fonts + section-frame/IG images + a WARM pass over every
     WebGL scene (shaders compiled, key textures uploaded, one frame rendered).
     Each WebGL init pushes a warm() into bootWarmups; any init can push asset
     URLs into extraPreload to have them fetched/decoded during the loader.
     Progress = 80% frames + 20% everything-else, shown on the curtain bar.
     ------------------------------------------------------- */
  const bootWarmups = [];    // WebGL warm callbacks: () => Promise|void
  const extraPreload = [];   // asset URLs to warm into the browser cache
  // Hero room-grid rotation target, in radians, written by the cinema tick
  // (one 90° step per checkpoint scene) and read by initRoomGrid's draw loop.
  // See [[hero-room-grid-cube]] + [[hero-motion-model]].
  let heroSceneRot = 0;
  let bootOtherDone = 0, bootOtherTotal = 0;
  let bootBarEl = null, bootPctEl = null;   // wired by initPreloader
  // The loader's gauge is an SVG ring: #preloaderBar is a <circle> (r=46 in a
  // 100-unit viewBox) whose dashoffset runs C→0 as boot progress reaches 100%.
  const BOOT_RING_C = 289.03;               // 2π · 46
  function updateBootUI() {
    const frames = FRAME_COUNT ? (loadedCount / FRAME_COUNT) : 1;
    const other = bootOtherTotal ? (bootOtherDone / bootOtherTotal) : 1;
    const p = Math.round((0.8 * frames + 0.2 * other) * 100);
    if (bootBarEl) bootBarEl.style.strokeDashoffset = (BOOT_RING_C * (1 - p / 100)).toFixed(2);
    if (bootPctEl) bootPctEl.textContent = p;
  }
  // Register a promise as a boot task (weighted into the 20% "other" bucket).
  // Never rejects — a failed asset must not stall the loader.
  function trackBoot(p) {
    bootOtherTotal++;
    const done = () => { bootOtherDone++; updateBootUI(); };
    return Promise.resolve(p).then((v) => { done(); return v; }, () => { done(); });
  }

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
  // "Good part" headline behind the character. gpTL is the paused
  // word-wipe timeline (built in initGoodPart); setGoodPart() plays /
  // reverses it. GP_REVEAL_FRAME is the animFrame at which the headline
  // wipes in — set on the reel's FINAL approach to center (it lands dead
  // center at frame 250 of TIMELINE_MAX/270). Triggering a touch before
  // that lets the word-wipe begin slightly earlier; the ~1.5s timeline
  // finishes just as the character settles centered.
  const goodPart = document.getElementById('goodPart');
  let gpTL = null;
  let gpShown = false;
  const GP_REVEAL_FRAME = 230;
  let asideSide = 0;   // -1 = right text shown (char left); 1 = left text shown (char right)
  let heroTerminal = null;   // left-aside terminal controller (see initHeroTerminal)
  let onBioUserScroll = null;   // set by initIgBio; lets a real user scroll instantly start the bio's disappear
  let callcard = null;       // upper-left typing intro controller (see initCallcard)
  // Parallax targets the WRAPPER (.topo-wrap): the svg itself carries the
  // CSS drift animation, so the two transforms live on separate elements
  // and both stay compositor-only (never re-rasterising the topo layer).
  const topoBg = document.querySelector('.topo-wrap');
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
    updateBootUI();   // drive the intro curtain's progress bar too

    if (loadedCount >= FRAME_COUNT && !everythingLoaded) {
      everythingLoaded = true;
      heroLoading?.classList.add('is-done');
      setTimeout(() => heroLoading?.remove(), 900);
    }
  }

  /* Boot preload helpers ------------------------------------------------ */
  // Await the web fonts so text never reflows after the curtain lifts.
  function fontsReady() {
    if (!(document && document.fonts && document.fonts.ready)) return Promise.resolve();
    return document.fonts.ready.catch(() => {});
  }
  // Fetch + decode a list of image URLs (section-frames, first IG image, …)
  // so they're warm in the cache before their lazy loaders assign them.
  function preloadUrlList(urls) {
    return Promise.all((urls || []).map((u) => new Promise((res) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = im.onerror = () => res();
      im.src = u;
    })));
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
    [cinemaAsideLeft, cinemaAsideRight]
      .filter((el) => el && !el.hasAttribute('data-no-blur'))   // skip the terminal
      .forEach((el) => {
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

  /* -------------------------------------------------------
     HERO TERMINAL — vanilla port of a shadcn/ui "Terminal"
     component. Types a short bash session (syntax-highlighted)
     then prints its output, line by line, with a blinking
     caret. Drives the left aside in place of the old statement.
     One-shot: .start() runs the session the first time the
     aside is revealed; later reveals just show the finished
     transcript. Keystroke audio from the original is dropped
     (it needs a bundled .ogg + a user gesture and would 404).
     ------------------------------------------------------- */
  function initHeroTerminal() {
    const body = document.getElementById('heroTermBody');
    if (!body) return null;

    // Portfolio-meaningful session (the old statement survives as output).
    const commands = [
      'whoami',
      'cat ~/manifesto.txt',
      './ship --intelligent-systems'
    ];
    const outputs = {
      0: ['aditya verma · ai + full-stack engineer'],
      1: [
        "I don't just write code — I build",
        'intelligent systems that feel fast,',
        'useful, and thoughtfully designed.'
      ],
      2: [
        '✔ compiled   ✔ tested   ✔ shipped',
        '→ products people actually want to use'
      ]
    };
    const TYPING_MS  = 52;     // per character
    const BETWEEN_MS = 950;    // gap between commands
    const OUT_MS     = 150;    // gap between output lines
    const INITIAL_MS = 420;    // first keystroke after reveal

    const PROMPT =
      '<span class="hterm__p-user">aditya</span>' +
      '<span class="hterm__p-host">@portfolio</span>' +
      '<span class="hterm__p-sep">:</span>' +
      '<span class="hterm__p-tilde">~</span>' +
      '<span class="hterm__p-dollar">$</span> ';

    const esc = (s) => s.replace(/[&<>]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    // tokenizeBash → coloured spans (port of the React highlighter).
    function highlight(text) {
      let first = true;
      return text.split(/(\s+)/).map((w) => {
        if (w === '') return '';
        if (/^\s+$/.test(w)) return esc(w);
        let type;
        if (w.startsWith('#')) type = 'comment';
        else if (w.startsWith('$')) { type = 'variable'; first = false; }
        else if (w.startsWith('-')) { type = 'flag'; first = false; }
        else if (/^["'].*["']$/.test(w)) { type = 'string'; first = false; }
        else if (/^\d+$/.test(w)) { type = 'number'; first = false; }
        else if (/^[|>&<]+$/.test(w)) { type = 'operator'; first = true; }
        else if (w.includes('/') || w.startsWith('.') || w.startsWith('~')) { type = 'path'; first = false; }
        else if (first) { type = 'command'; first = false; }
        else type = 'default';
        return '<span class="hterm__t-' + type + '">' + esc(w) + '</span>';
      }).join('');
    }

    function newLine(cls) {
      const d = document.createElement('div');
      d.className = cls;
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      return d;
    }

    let started = false;

    // Reduced motion: render the whole transcript at once, no typing.
    function renderInstant() {
      commands.forEach((cmd, i) => {
        newLine('hterm__line').innerHTML = PROMPT + highlight(cmd);
        (outputs[i] || []).forEach((o) => { newLine('hterm__out').textContent = o; });
      });
      const tail = newLine('hterm__line');
      tail.innerHTML = PROMPT;
      const cur = document.createElement('span');
      cur.className = 'hterm__cursor hterm__cursor--blink';
      tail.appendChild(cur);
    }

    function runCommand(i) {
      if (i >= commands.length) return;
      const cmd = commands[i];
      const line = newLine('hterm__line');
      const text = document.createElement('span');
      const cursor = document.createElement('span');
      cursor.className = 'hterm__cursor';
      line.appendChild(text);
      line.appendChild(cursor);
      line.insertAdjacentHTML('afterbegin', PROMPT);

      let c = 0;
      (function typeChar() {
        text.innerHTML = highlight(cmd.slice(0, c));
        body.scrollTop = body.scrollHeight;
        if (c < cmd.length) {
          c++;
          setTimeout(typeChar, TYPING_MS + Math.random() * 30);
        } else {
          cursor.remove();
          printOutputs(i);
        }
      })();
    }

    function printOutputs(i) {
      const outs = outputs[i] || [];
      let k = 0;
      (function next() {
        if (k < outs.length) {
          newLine('hterm__out').textContent = outs[k];
          k++;
          setTimeout(next, OUT_MS);
        } else if (i < commands.length - 1) {
          setTimeout(() => runCommand(i + 1), BETWEEN_MS);
        } else {
          // Final idle prompt with a blinking caret.
          const tail = newLine('hterm__line');
          tail.innerHTML = PROMPT;
          const cur = document.createElement('span');
          cur.className = 'hterm__cursor hterm__cursor--blink';
          tail.appendChild(cur);
        }
      })();
    }

    return {
      start() {
        if (started) return;
        started = true;
        if (reduceMotionMQ && reduceMotionMQ.matches) { renderInstant(); return; }
        setTimeout(() => runCommand(0), INITIAL_MS);
      }
    };
  }

  /* -------------------------------------------------------
     CALLCARD TYPING  the intro line + hand-drawn arrow.
     EDGE-TRIGGERED via setVisible (bound to the right element's
     reveal in updateAside): on appear it fades/slides in
     (.is-in), types the line fast, and draws the arrow; on
     leave it fades out coherently and resets after the fade so
     it replays next time. A sizer reserves the full height so
     the arrow never jumps as the text types.
     ------------------------------------------------------- */
  function initCallcard() {
    const el = document.getElementById('callcardType');
    if (!el) return null;
    const fig = el.closest('.callcard');
    const TEXT = 'Hi, I am Aditya, a Computer Science student at Arizona State University building at the intersection of AI, full-stack engineering, and product-focused design.';
    const SPEED = 8;   // ms/char  snappy
    el.textContent = '';
    // Invisible sizer holds the FULL line so the box keeps its final height
    // from the start; the live (typed) text is overlaid, so nothing reflows
    // as it types and the arrow never moves.
    const sizer = document.createElement('span');
    sizer.className = 'callcard__sizer';
    sizer.setAttribute('aria-hidden', 'true');
    sizer.textContent = TEXT;
    const live = document.createElement('span');
    live.className = 'callcard__live';
    const typed = document.createElement('span');
    typed.className = 'callcard__typed';
    const caret = document.createElement('span');
    caret.className = 'callcard__caret';
    live.appendChild(typed);
    live.appendChild(caret);
    el.appendChild(sizer);
    el.appendChild(live);
    const reduce = reduceMotionMQ && reduceMotionMQ.matches;
    let visible = false;
    let typeTimer = null;
    let hideTimer = null;

    function appear() {
      clearTimeout(hideTimer);
      if (fig) {
        fig.classList.add('is-in');                 // fade/slide the whole card in
        fig.classList.remove('is-drawn'); void fig.offsetWidth; fig.classList.add('is-drawn');  // (re)draw arrow
      }
      if (reduce) { typed.textContent = TEXT; return; }
      let i = 0;
      typed.textContent = '';
      (function type() {
        typed.textContent = TEXT.slice(0, i);
        if (i < TEXT.length) { i++; typeTimer = setTimeout(type, SPEED); }
      })();
    }

    function disappear() {
      clearTimeout(typeTimer);
      if (fig) fig.classList.remove('is-in');        // fade/slide text + arrow out together
      hideTimer = setTimeout(function () {           // reset only AFTER the fade-out
        typed.textContent = '';
        if (fig) fig.classList.remove('is-drawn');
      }, 600);
    }

    return {
      setVisible(v) {
        if (v && !visible) { visible = true; appear(); }
        else if (!v && visible) { visible = false; disappear(); }
      }
    };
  }

  /* -------------------------------------------------------
     TESTIMONIALS — vanilla port of a 3D-perspective vertical
     marquee. Builds N columns of testimonial cards (initials
     avatars, no external images) into #testiScene; columns
     scroll in alternating directions via a pure-CSS marquee
     (two copies per track, translateY -50% = seamless loop)
     and pause on hover. Fills the right half opposite the
     character. NOTE: placeholder testimonials — swap for real
     ones when available.
     ------------------------------------------------------- */
  function initTestimonials() {
    const scene = document.getElementById('testiScene');
    if (!scene) return;
    const data = [
      { name: 'Ava Green',   handle: '@ava',  flag: '\u{1F1E6}\u{1F1FA}', body: 'Shipped our AI feature in days, not months.' },
      { name: 'Mateo Rossi', handle: '@mat',  flag: '\u{1F1EE}\u{1F1F9}', body: 'Clean code and a sharp design eye — rare combo.' },
      { name: 'Maya Patel',  handle: '@maya', flag: '\u{1F1EE}\u{1F1F3}', body: 'The interface just feels fast and thoughtful.' },
      { name: 'Noah Smith',  handle: '@noah', flag: '\u{1F1FA}\u{1F1F8}', body: 'Took our messy idea and made it ship-ready.' },
      { name: 'Emma Lee',    handle: '@emma', flag: '\u{1F1E8}\u{1F1E6}', body: 'Best engineer-designer I have worked with.' },
      { name: 'Lucas Stone', handle: '@luc',  flag: '\u{1F1EB}\u{1F1F7}', body: 'Turned real complexity into something effortless.' },
      { name: 'Haruto Sato', handle: '@haru', flag: '\u{1F1EF}\u{1F1F5}', body: 'Pixel-perfect and fast on every device.' },
      { name: 'Carlos Ray',  handle: '@carl', flag: '\u{1F1EA}\u{1F1F8}', body: 'Delivers polished products people love.' },
      { name: 'Ana Miller',  handle: '@ana',  flag: '\u{1F1E9}\u{1F1EA}', body: 'Creative, reliable, genuinely fun to build with.' }
    ];
    const palette = ['#C9B8FF', '#A8E6CF', '#FFD3B6', '#FFAAA5', '#B5D8FF', '#FFE0AC', '#D6C7FF', '#BFE8D0', '#F7C8E0'];
    const COLS = 4;

    function card(t, i) {
      const el = document.createElement('figure');
      el.className = 'tcard';
      el.innerHTML =
        '<div class="tcard__head">' +
          '<span class="tcard__avatar" style="background:' + palette[i % palette.length] + '">' + t.name.charAt(0) + '</span>' +
          '<div class="tcard__id">' +
            '<figcaption class="tcard__name">' + t.name + ' <span class="tcard__flag">' + t.flag + '</span></figcaption>' +
            '<span class="tcard__handle">' + t.handle + '</span>' +
          '</div>' +
        '</div>' +
        '<blockquote class="tcard__body">' + t.body + '</blockquote>';
      return el;
    }

    scene.textContent = '';
    for (let c = 0; c < COLS; c++) {
      const col = document.createElement('div');
      col.className = 'tcol';
      const track = document.createElement('div');
      track.className = 'tcol__track ' + (c % 2 ? 'tcol__track--down' : 'tcol__track--up');
      const rot = data.slice(c * 2).concat(data.slice(0, c * 2));   // offset order per column
      rot.concat(rot).forEach((t, i) => track.appendChild(card(t, i + c)));   // 2 copies → seamless
      col.appendChild(track);
      scene.appendChild(col);
    }
  }

  /* -------------------------------------------------------
     IG POST — Instagram-style image carousel (vanilla port of
     an "Instagram skeleton screen") pinned to the left edge.
     Click the image or a dot to advance; images change with a
     SLIDING transition (each image is an absolute slide that is
     preloaded then translated in while the old slides out).
     The heart is an animated like toggle (port of HeartFavorite).
     ------------------------------------------------------- */
  function initIgPost() {
    const media = document.getElementById('igMedia');
    const dotsWrap = document.getElementById('igDots');
    let cur = document.getElementById('igImg');
    if (!media || !dotsWrap || !cur) return;
    const srcs = [];
    // NOTE: folder is 'Instagram-Images' (capital I's) — must match the on-disk /
    // git-committed case exactly, or it 404s on case-sensitive hosts (e.g. Vercel/Linux).
    for (let k = 1; k <= 14; k++) srcs.push('Instagram-Images/' + k + '.png');
    // Warm the first couple of IG slides during the loader so the aside is
    // never blank on first view (the rest stay lazy — 19 MB total).
    extraPreload.push(srcs[0], srcs[1]);
    const n = srcs.length;
    let idx = 0;
    let animating = false;
    const skeleton = media.querySelector('.igpost__skeleton');

    const dots = srcs.map(function (_, i) {
      const d = document.createElement('span');
      d.className = 'igpost__dot';
      d.addEventListener('click', function (e) { e.stopPropagation(); go(i, i > idx ? 1 : -1); resetAuto(); });
      dotsWrap.appendChild(d);
      return d;
    });
    function syncDots() { dots.forEach(function (d, i) { d.classList.toggle('is-active', i === idx); }); }

    function preload(src, cb) { const im = new Image(); im.onload = function () { cb(im); }; im.onerror = function () { cb(null); }; im.src = src; }

    // First image: skeleton until it loads.
    media.classList.add('is-loading');
    preload(srcs[0], function (im) { media.classList.remove('is-loading'); if (im) cur.src = im.src; });
    syncDots();

    function go(target, dir) {
      target = (target % n + n) % n;
      if (animating || target === idx) return;
      animating = true;
      preload(srcs[target], function (im) {
        if (!im) { animating = false; return; }
        const next = document.createElement('img');
        next.className = 'igpost__slide';
        next.alt = 'Instagram post';
        next.src = im.src;
        next.style.transition = 'none';
        next.style.transform = 'translateX(' + (dir * 100) + '%)';   // start off-screen
        if (skeleton) media.insertBefore(next, skeleton); else media.appendChild(next);
        void next.offsetWidth;                                       // commit start position
        next.style.transition = '';                                  // re-enable CSS transition
        next.style.transform = 'translateX(0)';
        cur.style.transform = 'translateX(' + (-dir * 100) + '%)';
        const old = cur;
        cur = next; idx = target; syncDots();
        let done = false;
        const finish = function () {
          if (done) return; done = true;
          old.remove();
          next.removeEventListener('transitionend', finish);
          animating = false;
        };
        next.addEventListener('transitionend', finish);
        setTimeout(finish, 800);   // fallback if transitionend doesn't fire
      });
    }

    media.addEventListener('click', function () { go(idx + 1, 1); resetAuto(); });

    /* Continuous auto-slideshow: advance one image every 2s, looping through all of them.
       Runs only while the IG aside is revealed (so it doesn't churn off-screen) and is
       skipped under reduced-motion. Manual nav (click / dot) restarts the countdown. */
    const aside = document.getElementById('cinemaAsideLeft');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const AUTO_MS = 2000;
    let auto = null;
    function startAuto() { if (auto || reduce) return; auto = setInterval(function () { go(idx + 1, 1); }, AUTO_MS); }
    function stopAuto() { if (auto) { clearInterval(auto); auto = null; } }
    function resetAuto() { if (auto) { stopAuto(); startAuto(); } }   // restart the 2s countdown after manual nav
    if (aside && !reduce) {
      let shown = aside.classList.contains('is-revealed');
      if (shown) startAuto();
      const obs = new MutationObserver(function () {
        const now = aside.classList.contains('is-revealed');
        if (now && !shown) { shown = true; startAuto(); }
        else if (!now && shown) { shown = false; stopAuto(); }
      });
      obs.observe(aside, { attributes: true, attributeFilter: ['class'] });
    }

    /* Animated like toggle */
    const likeBtn = document.getElementById('igLike');
    const likeCount = document.getElementById('igLikeCount');
    if (likeBtn && likeCount) {
      let liked = true;
      const BASE = 107;
      function syncLike() {
        likeBtn.classList.toggle('is-liked', liked);
        likeBtn.setAttribute('aria-pressed', String(liked));
        likeCount.textContent = String(BASE + (liked ? 1 : 0));
      }
      likeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        liked = !liked;
        syncLike();
        if (liked) { likeBtn.classList.remove('is-pop'); void likeBtn.offsetWidth; likeBtn.classList.add('is-pop'); }
      });
      syncLike();
    }

    /* Animated save toggle — same interaction as the like, but the bookmark
       fills in currentColor (white over the dark IG panel) via .is-saved. */
    const saveBtn = document.querySelector('.igpost__act--save');
    if (saveBtn) {
      let saved = false;
      saveBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        saved = !saved;
        saveBtn.classList.toggle('is-saved', saved);
        saveBtn.setAttribute('aria-pressed', String(saved));
        if (saved) { saveBtn.classList.remove('is-pop'); void saveBtn.offsetWidth; saveBtn.classList.add('is-pop'); }
      });
    }
  }

  /* Instagram "stories" row above the post — vanilla port of the typewriter-testimonial
     React component (no audio: this project has no /audio assets). Each gradient-ringed
     avatar, on hover, scales up and types its caption into a speech-bubble tooltip. */
  function initIgStories() {
    const wrap = document.getElementById('igStories');
    if (!wrap) return;
    const stories = [
      { img: 'ppic.jpg',                 label: 'aditya',  text: "That's me — building things, and chasing a bit of balance." },
      { img: 'story-covers/gym.jpg',     label: 'gym',     text: 'Lifting keeps me disciplined and clears my head.' },
      { img: 'story-covers/travel.jpg',  label: 'travel',  text: 'Always up for exploring somewhere new.' },
      { img: 'story-covers/music.jpg',   label: 'music',   text: 'Guitar and singing are how I slow down.' },
      { img: 'story-covers/friends.jpg', label: 'friends', text: 'The simple moments with people I care about.' }
    ];
    // The story-covers are swapped often during dev; bust their cache with a per-load token so
    // an updated file always shows on a normal reload (no manual ?v bump / hard-refresh needed).
    const bust = '?t=' + Date.now();
    let timer = null;

    stories.forEach(function (s) {
      const item = document.createElement('div');
      item.className = 'igstory';

      const tip = document.createElement('div');
      tip.className = 'igstory__tip';
      const body = document.createElement('div');
      body.className = 'igstory__tip-body';
      const tipText = document.createElement('span');
      tipText.className = 'igstory__tip-text';
      const caret = document.createElement('span');
      caret.className = 'igstory__caret';
      caret.textContent = '|';
      body.appendChild(tipText); body.appendChild(caret);
      const dots = document.createElement('div');
      dots.className = 'igstory__dots';
      dots.innerHTML = '<i></i><i></i><i></i>';
      tip.appendChild(body); tip.appendChild(dots);

      const ring = document.createElement('span');
      ring.className = 'igstory__ring';
      const img = document.createElement('img');
      img.className = 'igstory__avatar';
      img.src = s.img.indexOf('story-covers/') === 0 ? (s.img + bust) : s.img; img.alt = '';
      ring.appendChild(img);

      const label = document.createElement('span');
      label.className = 'igstory__label';
      label.textContent = s.label;

      item.appendChild(tip); item.appendChild(ring); item.appendChild(label);
      wrap.appendChild(item);

      function type(text) {
        if (timer) { clearTimeout(timer); timer = null; }
        tipText.textContent = '';
        let i = 0;
        (function step() {
          if (i <= text.length) { tipText.textContent = text.slice(0, i); i++; timer = setTimeout(step, 40); }
        })();
      }
      item.addEventListener('mouseenter', function () { item.classList.add('is-active'); type(s.text); });
      item.addEventListener('mouseleave', function () {
        item.classList.remove('is-active');
        if (timer) { clearTimeout(timer); timer = null; }
        tipText.textContent = '';
      });
    });
  }

  /* Bio reveal — every LINE is written at the same time: each step reveals the next
     character of EVERY line simultaneously, so all lines fill in left-to-right together.
     On hide, the whole block does a smooth fade + blur + drift-up disappear. Replays on
     each visit. Every char is laid out up-front so wrapping is fixed (no reflow); reveal
     and exit are opacity/filter/transform only (compositor, layout-neutral). */
  function initIgBio() {
    const aside = document.getElementById('cinemaAsideLeft');
    const bio = aside && aside.querySelector('.igbio');
    const textEl = aside && aside.querySelector('.igbio__text');
    if (!aside || !bio || !textEl) return;
    const full = textEl.textContent;
    const oldCaret = aside.querySelector('.igbio__caret');
    if (oldCaret) oldCaret.remove();   // no single caret: lines write in parallel now
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    textEl.textContent = '';
    const chars = [];
    for (let k = 0; k < full.length; k++) {
      const s = document.createElement('span');
      s.className = 'igbio__ch';
      s.textContent = full.charAt(k);
      textEl.appendChild(s);
      chars.push(s);
    }

    // Highlight words spaced evenly through the paragraph (roughly one every
    // other line, top → bottom) so the markers read as a uniform rhythm rather
    // than a cluster. Tag their char spans so the highlight fades with the write.
    const HL_WORDS = ['keeping', 'meaningful', 'guitar', 'friends', 'connected'];
    const lowerFull = full.toLowerCase();
    HL_WORDS.forEach(function (w) {
      let from = 0, idx;
      while ((idx = lowerFull.indexOf(w, from)) !== -1) {
        const before = idx === 0 ? '' : lowerFull.charAt(idx - 1);
        const after = lowerFull.charAt(idx + w.length);
        if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) {
          for (let k = idx; k < idx + w.length; k++) {
            if (chars[k]) chars[k].classList.add('igbio__ch--hl');
          }
        }
        from = idx + w.length;
      }
    });

    if (reduce) { for (let k = 0; k < chars.length; k++) chars[k].classList.add('is-on'); return; }

    // Group the laid-out chars into visual lines by vertical position.
    function buildLines() {
      const lines = []; let top = null, cur = null;
      for (let k = 0; k < chars.length; k++) {
        const t = chars[k].offsetTop;
        if (top === null || Math.abs(t - top) > 2) { cur = []; lines.push(cur); top = t; }
        cur.push(chars[k]);
      }
      return lines;
    }

    let timer = null;
    function clearAll() { for (let k = 0; k < chars.length; k++) chars[k].classList.remove('is-on'); }

    const STEP = 40;
    // WRITE IN: reveal char index i across EVERY line each step (all lines write together).
    function writeIn() {
      if (timer) { clearTimeout(timer); timer = null; }
      clearAll();
      const lines = buildLines();
      let maxLen = 0;
      for (let k = 0; k < lines.length; k++) maxLen = Math.max(maxLen, lines[k].length);
      let i = 0;
      (function step() {
        for (let l = 0; l < lines.length; l++) if (i < lines[l].length) lines[l][i].classList.add('is-on');
        i++;
        if (i < maxLen) timer = setTimeout(step, STEP);
      })();
    }

    // DISAPPEAR: the mirror of writeIn — un-write char index i across EVERY line, from the
    // last column back to the first (all lines erase together, right-to-left), same fade.
    function writeOut() {
      if (timer) { clearTimeout(timer); timer = null; }
      const lines = buildLines();
      let maxLen = 0;
      for (let k = 0; k < lines.length; k++) maxLen = Math.max(maxLen, lines[k].length);
      let i = maxLen - 1;
      (function step() {
        for (let l = 0; l < lines.length; l++) if (i >= 0 && i < lines[l].length) lines[l][i].classList.remove('is-on');
        i--;
        if (i >= 0) timer = setTimeout(step, STEP);
      })();
    }

    let shown = aside.classList.contains('is-revealed');
    let outByScroll = false;
    clearAll();
    const obs = new MutationObserver(function () {
      const now = aside.classList.contains('is-revealed');
      if (now && !shown) { shown = true; outByScroll = false; writeIn(); }
      else if (!now && shown) { shown = false; writeOut(); }
    });
    obs.observe(aside, { attributes: true, attributeFilter: ['class'] });

    // A real user scroll (either direction) instantly starts the disappear while the bio is
    // on screen, and it STAYS gone — it only re-writes on a fresh reveal (when the character
    // returns to the IG pose). No reappear-on-settle (that flickered the text back mid-erase).
    // Driven from onHeroScrollInput (auto-scroll is absorbed there, so the reel can't trigger it).
    onBioUserScroll = function () {
      if (!shown || outByScroll) return;
      outByScroll = true;
      writeOut();
    };

    if (shown) writeIn();
  }

  /* Hover perspective tilt for ONLY the Instagram UI (stories/post/dock). The panel keeps
     its fixed rotateY; the UI (.iguicard, inside its own .iguifx perspective) tilts toward
     the cursor: full strength inside the UI, fading across the next 2 card-radii, lerped
     each frame for a smooth follow. Writes --rx/--ry onto .iguifx (CSS reads them on
     .iguicard). Runs only while the IG aside is revealed (rAF starts on reveal, stops +
     flattens on hide); skipped under reduced-motion and on perf-lite devices. */
  function initIgUiTilt() {
    const fx = document.querySelector('.iguifx');
    const card = document.querySelector('.igcol');   // cursor math centres on the UI bounds
    const aside = document.getElementById('cinemaAsideLeft');
    if (!fx || !card || !aside) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || document.body.classList.contains('perf-lite')) return;

    const MAX_RX = 8, MAX_RY = 11, SMOOTH = 0.12;
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    let targetX = 0, targetY = 0, rotX = 0, rotY = 0, raf = 0, running = false;

    function onMove(e) {
      const r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const dist = Math.hypot(dx, dy);
      const falloff = dist <= 1 ? 1 : Math.max(0, 1 - (dist - 1) / 2);   // fade over 2 radii
      targetX = clamp(dy, -1, 1) * MAX_RX * falloff;
      targetY = -clamp(dx, -1, 1) * MAX_RY * falloff;
      kick();
    }
    function kick() { if (running && !raf) raf = requestAnimationFrame(tick); }
    function onLeave() { targetX = 0; targetY = 0; kick(); }
    function tick() {
      rotX += (targetX - rotX) * SMOOTH;
      rotY += (targetY - rotY) * SMOOTH;
      fx.style.setProperty('--rx', rotX.toFixed(2) + 'deg');
      fx.style.setProperty('--ry', rotY.toFixed(2) + 'deg');
      // Settled → stop scheduling (mousemove re-kicks). Without this the
      // lerp kept writing two custom props — a style recalc every frame —
      // for as long as the aside stayed revealed, cursor parked or not.
      if (Math.abs(targetX - rotX) < 0.02 && Math.abs(targetY - rotY) < 0.02) {
        rotX = targetX; rotY = targetY;
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    function start() {
      if (running) return;
      // Re-check here (not just at init): the FPS probe can add perf-lite
      // a few seconds into the session, after this module was created.
      if (document.body.classList.contains('perf-lite')) return;
      running = true;
      window.addEventListener('mousemove', onMove);
      document.addEventListener('mouseleave', onLeave);
      tick();
    }
    function stop() {
      if (!running) return;
      running = false;
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
      raf = 0;
      targetX = targetY = rotX = rotY = 0;
      fx.style.setProperty('--rx', '0deg');
      fx.style.setProperty('--ry', '0deg');
    }
    let shown = aside.classList.contains('is-revealed');
    if (shown) start();
    const obs = new MutationObserver(function () {
      const now = aside.classList.contains('is-revealed');
      if (now && !shown) { shown = true; start(); }
      else if (!now && shown) { shown = false; stop(); }
    });
    obs.observe(aside, { attributes: true, attributeFilter: ['class'] });
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
    // Tie the upper-left intro card to the right testimonials element: it
    // appears and disappears exactly when they do (char on the left = side -1).
    if (callcard) callcard.setVisible(side === -1);
    cinemaAsideLeft.classList.toggle('is-revealed', side === 1);
    // First time the terminal aside appears, boot it (one-shot).
    if (side === 1 && heroTerminal) heroTerminal.start();
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
  /* Breath shaping — the eased inhale/exhale curve now lives in styles.css
     as @keyframes heroBreathe on the .hero-stage__breathe wrapper (0% → 42%
     inhale, 42% → 100% exhale, each segment easeInOutSine via
     cubic-bezier(0.37, 0, 0.63, 1), ±7px over 3.2s). Compositor-driven, so
     the reel loop no longer has to run at rest just to breathe. */
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
    // Staged playback — the reel parks at scripted checkpoints and only
    // advances to the next on a FRESH scroll gesture (see CHECKPOINTS).
    gateIndex: 0,               // which CHECKPOINTS entry we're heading to / parked at
    lastScrollEventT: 0,        // perf.now() of the last user scroll event (gesture split)
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
  // Idle breathing: compositor-side CSS animation on .hero-stage__breathe
  // (±7px / 3.2s — see @keyframes heroBreathe in styles.css). Its transform
  // COMPOSES with the canvas's JS transform, so cursor motion never snaps it.

  // STAGED PLAYBACK — instead of one continuous forward run to TIMELINE_MAX,
  // the reel pauses at scripted checkpoints. Each fresh forward scroll gesture
  // unlocks the next stop; a fresh reverse gesture steps back one. CHECKPOINTS[0]
  // is the intro hold (HOLD_FRAME); the rest are the stops the user asked for:
  //   load → autoplay to 73 (hold) → scroll #1 → 127 → scroll #2 → 183 →
  //   scroll #3 → 270 (complete).
  const CHECKPOINTS    = [HOLD_FRAME, 127, 183, TIMELINE_MAX];
  // A gap of silence this long marks the next scroll event as a NEW gesture.
  // Continuous wheel/trackpad input (incl. inertia) fires faster than this, so
  // one swipe = one gesture = one checkpoint, regardless of how far you scroll.
  const GESTURE_GAP_MS = 140;

  // When motionTick programmatically scrolls the page to keep
  // scrollY in sync with animFrame, ScrollTrigger still fires
  // onUpdate. This flag tells onUpdate to absorb that auto-scroll
  // delta (update lastScrollProgress only) rather than treat it
  // as user input that could flip the play direction.
  let isAutoScrolling = false;
  // Pending timer that hands scroll ownership back to the user shortly
  // after the reel parks (trailing scroll events from the last
  // programmatic scrollTo arrive async and must still be absorbed).
  let autoScrollClearT = 0;


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
      // Exit-snap: park the reel on the boundary matching the side we left
      // from, so re-entry is already in sync (no desync teleport). This runs
      // while the hero is OFF-SCREEN, so the correction is never visible — it
      // only matters if the user outran the crawl on the way out. Below the pin
      // runway (into the warp) → assembled (MAX); above the hero → the hold pose.
      if (motion.hasScrolled && motion.pinRunway > 0) {
        if (window.scrollY >= motion.heroSectionTop + motion.pinRunway) {
          motion.animFrame = TIMELINE_MAX; motion.gateIndex = CHECKPOINTS.length - 1;
        } else if (window.scrollY <= motion.heroSectionTop) {
          motion.animFrame = HOLD_FRAME; motion.gateIndex = 0;
        }
      }
      if (callcard) callcard.setVisible(false);   // reset typing so it replays on re-entry
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

    // --- Idle breathing ---
    // Lives ENTIRELY on the compositor now: a CSS keyframe animation on the
    // .hero-stage__breathe wrapper (styles.css) that replicates the old
    // breathePos() curve exactly. It composes with this loop's canvas
    // transform, so nothing snaps — and, crucially, the loop can fully
    // SUSPEND at rest again. Folding a breathe offset into the JS transform
    // kept a style write + full commit running every rAF for the whole
    // session, which measured as THE dominant hero frame cost on slow CPUs.

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
    // The frame the reel is currently driving toward: HOLD_FRAME during the
    // intro autoplay, otherwise the unlocked checkpoint. Forward scroll bumps
    // gateIndex up (next stop), reverse bumps it down — see onHeroScrollInput.
    const target = motion.hasScrolled ? CHECKPOINTS[motion.gateIndex] : HOLD_FRAME;
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
    } else if (motion.animFrame < target - 0.01) {
      shouldAdvance = true;                     // play forward to the next stop
      advanceStep = BASE_RATE;
    } else if (motion.animFrame > target + 0.01) {
      shouldAdvance = true;                     // reverse back to the prior stop
      advanceStep = -BASE_RATE;
    } else {
      motion.animFrame = target;                // snap & park exactly on the stop
      shouldAdvance = false;
    }

    if (shouldAdvance) {
      motion.animFrame += advanceStep * rate;   // delta-time scaled
      // Clamp to the checkpoint so we land precisely and park there.
      if (advanceStep > 0 && motion.animFrame > target) motion.animFrame = target;
      else if (advanceStep < 0 && motion.animFrame < target) motion.animFrame = target;
      if (motion.animFrame > TIMELINE_MAX) motion.animFrame = TIMELINE_MAX;
      else if (motion.animFrame < 0) motion.animFrame = 0;
    }

    // --- Post-pin tail: keep the reel parked at MAX while reversing ---
    // Below the pin runway (the last-100vh tail where the pin has released and
    // the assembled character scrolls natively) the reel must stay at
    // TIMELINE_MAX on the way back up — exactly as the forward pass leaves it
    // scrolling through that tail. Reverse-crawl only begins once the runway is
    // re-entered. Without this the reverse-follow computed a followY a full
    // viewport away and teleported the page from the tail straight to the
    // pinned character view — the "snap to the character page". The reel is
    // already parked at MAX here (see the off-screen exit-snap), so in the
    // normal case this is a no-op; it just holds through the tail.
    if (motion.playDirection === -1 && motion.hasScrolled && motion.pinRunway > 0 &&
        window.scrollY > motion.heroSectionTop + motion.pinRunway + 4) {
      motion.animFrame = TIMELINE_MAX;       // hold assembled through the tail
      shouldAdvance = false;                 // no crawl + no follow through the tail
      // NB: gateIndex is deliberately NOT reset here — reverse gestures made in
      // the tail must still step it back, so the reel is already aimed at the
      // right checkpoint the moment the runway is re-entered and the crawl runs.
    }

    // --- Room-grid rotation target (one 90° cube turn per checkpoint scene) ---
    // Map the (now-final) reel frame onto a continuous "scene" coordinate: 0 at
    // the first checkpoint, +1 at each subsequent one. Each whole step is a
    // quarter-turn, so the room settles exactly square-on whenever the reel is
    // parked on a scene and turns as it crawls to the next — the current floor
    // becomes the next scene's back wall. Read by initRoomGrid.
    // ROT_LEAD (<1) compresses each turn so the cube completes it at ROT_LEAD of
    // the crawl and PLATEAUS for the remainder — the background finishes its
    // rotation slightly before the character arrives at the page (owner request).
    {
      const ROT_LEAD = 0.85;
      const f = motion.animFrame;
      const last = CHECKPOINTS.length - 1;
      let s;
      if (f <= CHECKPOINTS[0]) {
        s = 0;
      } else if (f >= CHECKPOINTS[last]) {
        s = last;
      } else {
        s = last;
        for (let i = 1; i <= last; i++) {
          if (f < CHECKPOINTS[i]) {
            const frac = (f - CHECKPOINTS[i - 1]) / (CHECKPOINTS[i] - CHECKPOINTS[i - 1]);
            s = (i - 1) + Math.min(frac / ROT_LEAD, 1);
            break;
          }
        }
      }
      heroSceneRot = s * (Math.PI / 2);
    }

    // --- Auto-scroll follow (2026-07, owner request) ---
    // Keep the scrollbar in sync with the character: map animFrame
    // (HOLD_FRAME → TIMELINE_MAX) onto the pin runway and pull scrollY
    // down to that point. Three guards keep this from becoming the old
    // scroll hijack (which scrolled unconditionally every frame and
    // fought the user — removed 2026-06):
    //   1. FORWARD-ONLY: never scrolls up, and if the user is already
    //      ahead of the character it does nothing.
    //   2. Only while the reel is actually TRAVELLING — parked reel =
    //      fully native scrolling.
    //   3. behavior:'instant' bypasses the page's scroll-behavior:smooth
    //      (the old per-frame smooth-scroll restart was half the jank).
    // ScrollTrigger/fallback absorb these via isAutoScrolling, so the
    // programmatic scroll can't release checkpoints or flip direction.
    // The follow works BOTH directions, but only ever moves the page in
    // the reel's direction of travel: forward play may only scroll DOWN
    // toward followY, reverse play may only scroll UP toward it. The
    // direction match is load-bearing — without it, the still-high frame
    // at the start of a reverse gesture put followY above the user's
    // fresh upward scroll and yanked the page back down (verified:
    // scrolling up at the runway end moved 8px instead of the wheel's
    // 400). The user can always outrun the follow; it never drags them
    // backwards against their input.
    if (shouldAdvance && motion.hasScrolled && motion.pinRunway > 0) {
      const scrollProg = clamp01(
        (motion.animFrame - HOLD_FRAME) / (TIMELINE_MAX - HOLD_FRAME)
      );
      const followY = motion.heroSectionTop + motion.pinRunway * scrollProg;
      const curY = window.scrollY;
      const follow = advanceStep > 0
        ? followY > curY + 1     // forward: pull the page down to the reel
        : followY < curY - 1;    // reverse: pull the page up to the reel
      if (follow) {
        isAutoScrolling = true;
        if (autoScrollClearT) { clearTimeout(autoScrollClearT); autoScrollClearT = 0; }
        window.scrollTo({ top: followY, left: 0, behavior: 'instant' });
      }
    } else if (isAutoScrolling && !autoScrollClearT) {
      // Reel parked: absorb the async event tail, then hand scroll back.
      autoScrollClearT = setTimeout(() => {
        isAutoScrolling = false;
        autoScrollClearT = 0;
      }, 160);
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
    setGoodPart(motion.animFrame >= GP_REVEAL_FRAME);

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
      // At rest: settle exactly and SUSPEND the loop — zero main-thread work
      // while the character idles (the compositor-side breathe wrapper keeps
      // the figure alive). Wake-up paths: scroll input (onUpdate/fallback)
      // and the cursor listeners — both call kickMotion.
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
    // Otherwise keep ticking: the reel is still moving or the cursor is
    // still settling toward its parallax target.
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
      setGoodPart(motion.animFrame >= GP_REVEAL_FRAME);
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
     onHeroScrollInput — translate a scroll delta into reel
     intent. Scroll is a discrete TRIGGER, not a force: each
     FRESH forward gesture unlocks the next checkpoint (and a
     fresh reverse gesture steps back one), then motionTick
     plays the reel to that stop at BASE_RATE and parks.
     A "fresh" gesture is the first event after >GESTURE_GAP_MS
     of silence, so one swipe advances exactly one stage no
     matter how far/fast it scrolls.
     ------------------------------------------------------- */
  function onHeroScrollInput(deltaProgress) {
    if (deltaProgress === 0) return;
    if (onBioUserScroll) onBioUserScroll();   // real user scroll (up or down) → bio starts disappearing now
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    const isNewGesture = (now - motion.lastScrollEventT) > GESTURE_GAP_MS;
    motion.lastScrollEventT = now;
    if (deltaProgress > 0) {
      const firstEver = !motion.hasScrolled;    // first forward scroll always releases stop #1
      motion.hasScrolled = true;
      motion.introDelayElapsed = true;          // skip intro wait if still pending
      motion.playDirection = 1;
      // Unlock the next stop only on a FRESH gesture AND once the reel has
      // actually arrived at the current one. The arrival guard is what makes a
      // single scroll advance exactly one stage — it can't skip ahead while the
      // reel is still travelling, no matter how the scroll/inertia events land.
      const arrived = firstEver ||
        motion.animFrame >= CHECKPOINTS[motion.gateIndex] - 0.5;
      if (isNewGesture && arrived && motion.gateIndex < CHECKPOINTS.length - 1) {
        motion.gateIndex++;                     // release the next stop
      }
    } else {
      motion.hasScrolled = true;
      motion.playDirection = -1;
      // Mirror the forward arrival guard: step back only on a FRESH gesture AND
      // once the reel has actually arrived at the current stop. Without this a
      // burst of reverse flicks (e.g. crossing the post-pin tail) decremented
      // gateIndex several times at once, so the reel crawled straight past the
      // intermediate screens instead of parking at each one.
      const arrivedRev = motion.animFrame <= CHECKPOINTS[motion.gateIndex] + 0.5;
      if (isNewGesture && arrivedRev && motion.gateIndex > 0) {
        motion.gateIndex--;                     // step back one stop
      }
    }
    kickMotion();
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
    // Direct user-intent taps. Wheel/touch are ALWAYS the user
    // (programmatic scrollTo never fires them), so they register
    // gestures even while the auto-scroll follow is mid-travel and the
    // scroll-event stream is being absorbed via isAutoScrolling.
    // Without these, a counter-gesture during the ~1.5s of follow
    // travel was swallowed whole (verified headless: a reverse wheel
    // arriving just before park was absorbed, leaving gateIndex stale
    // so the next forward gesture jumped TWO stops). The tiny delta
    // only conveys direction; onHeroScrollInput's gesture-gap and
    // arrival guards do the rest. Ordinary gestures fire here first
    // and the trailing scroll events land inside GESTURE_GAP_MS, so
    // they merge into the same gesture — no double-release.
    window.addEventListener('wheel', (e) => {
      if (!motion.heroVisible || !e.deltaY) return;
      onHeroScrollInput(e.deltaY > 0 ? 0.001 : -0.001);
    }, { passive: true });
    let heroTouchY = 0;
    window.addEventListener('touchstart', (e) => {
      if (e.touches.length) heroTouchY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!motion.heroVisible || !e.touches.length) return;
      const dy = heroTouchY - e.touches[0].clientY;   // finger up = scroll down
      heroTouchY = e.touches[0].clientY;
      if (dy) onHeroScrollInput(dy > 0 ? 0.001 : -0.001);
    }, { passive: true });

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
        motion.lastScrollProgress = p;
        onHeroScrollInput(deltaProgress);
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
          motion.lastScrollProgress = newProgress;
          onHeroScrollInput(deltaProgress);
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
     initGooeyOrb — the loading screen's centrepiece. Vanilla
     WebGL1 port of the "liquid gooey orb" shader (raymarched
     glassy blob, swirling liquid filaments inside, glow only
     OUTSIDE the silhouette), rethemed to the site: chartreuse +
     cream liquid in ink glass over the loader's #0B0B0A, so the
     opaque canvas melts seamlessly into the boot screen. Brand
     palette + shape params are baked into the shader (only
     u_time/u_res uniforms). Runs ONLY while the loader is up —
     initPreloader stops it as the curtain lifts. Same raw-WebGL
     conventions as initHeroGrid/initWarpTunnel (WebGL1, capped
     DPR, context-loss guard, stop()).
     ------------------------------------------------------- */
  function initGooeyOrb(cv) {
    if (!cv) return null;
    let gl = null;
    try {
      gl = cv.getContext('webgl', { alpha: false, antialias: false }) ||
           cv.getContext('experimental-webgl', { alpha: false, antialias: false });
    } catch (e) { /* fall through */ }
    if (!gl) { cv.style.display = 'none'; return null; }

    const VERT =
      'attribute vec2 a_pos;\n' +
      'varying vec2 v_uv;\n' +
      'void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }';

    // Site palette: COL_A chartreuse rim/liquid, COL_B cream, olive outer
    // glow, ink background. Motion = the source's "Aurora" preset.
    const FRAG =
      'precision highp float;\n' +
      'varying vec2 v_uv;\n' +
      'uniform float u_time;\n' +
      'uniform vec2  u_res;\n' +
      'uniform float u_intro;\n' +   // 0→1 materialize (slight >1 overshoot)

      '#define COL_A vec3(0.847, 1.000, 0.220)\n' +   // #D8FF38
      '#define COL_B vec3(0.949, 0.933, 0.898)\n' +   // #F2EEE5
      '#define GLOW_A vec3(0.847, 1.000, 0.220)\n' +
      '#define GLOW_B vec3(0.478, 0.580, 0.125)\n' +  // #7A9420 olive
      '#define BG vec3(0.043, 0.043, 0.039)\n' +      // #0B0B0A loader ink
      '#define RADIUS 0.30\n' +
      '#define DEFORM 0.36\n' +
      '#define FREQ 2.0\n' +
      '#define MORPH 1.30\n' +
      '#define ROTSP 0.12\n' +
      '#define SHINE 150.0\n' +
      '#define GLOWSTR 0.55\n' +
      '#define LSPEED 0.50\n' +
      '#define LSCALE 2.20\n' +
      '#define FILAMENT 1.40\n' +
      '#define CORE 0.30\n' +
      'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }\n' +
      // organic blob: sphere radius modulated by slow drifting sine lobes
      'float blobField(vec3 p){\n' +
      '  float t = u_time * MORPH;\n' +
      '  float d = 0.0;\n' +
      '  d += sin(p.x * 2.6 * FREQ + t * 1.00);\n' +
      '  d += sin(p.y * 2.9 * FREQ - t * 0.80 + 1.3);\n' +
      '  d += sin(p.z * 3.2 * FREQ + t * 1.20 + 2.7);\n' +
      '  d += sin((p.x + p.z) * 2.2 * FREQ - t * 0.90 + 4.1);\n' +
      '  d += sin((p.y - p.x) * 2.4 * FREQ + t * 0.70 + 0.6);\n' +
      '  return d * 0.2;\n' +
      '}\n' +
      'float mapBlob(vec3 p){\n' +
      '  float t = u_time * ROTSP;\n' +
      '  p.xy *= rot(t * 0.7);\n' +
      '  p.yz *= rot(t * 0.5);\n' +
      // whole field scales with u_intro: the blob inflates from a point,
      // wobble and all, instead of popping in fully formed
      '  float r = (RADIUS + DEFORM * blobField(p)) * u_intro;\n' +
      '  return length(p) - r;\n' +
      '}\n' +
      'vec3 calcNormal(vec3 p){\n' +
      '  vec2 e = vec2(0.0015, 0.0);\n' +
      '  return normalize(vec3(\n' +
      '    mapBlob(p + e.xyy) - mapBlob(p - e.xyy),\n' +
      '    mapBlob(p + e.yxy) - mapBlob(p - e.yxy),\n' +
      '    mapBlob(p + e.yyx) - mapBlob(p - e.yyx)));\n' +
      '}\n' +
      // 3D noise for the swirling liquid inside the glass
      'float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }\n' +
      'float vnoise3(vec3 p){\n' +
      '  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n' +
      '  return mix(mix(mix(hash13(i + vec3(0.0,0.0,0.0)), hash13(i + vec3(1.0,0.0,0.0)), f.x),\n' +
      '                 mix(hash13(i + vec3(0.0,1.0,0.0)), hash13(i + vec3(1.0,1.0,0.0)), f.x), f.y),\n' +
      '             mix(mix(hash13(i + vec3(0.0,0.0,1.0)), hash13(i + vec3(1.0,0.0,1.0)), f.x),\n' +
      '                 mix(hash13(i + vec3(0.0,1.0,1.0)), hash13(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);\n' +
      '}\n' +
      'float fbm3(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ v += a * vnoise3(p); p *= 2.03; a *= 0.5; } return v; }\n' +
      // domain-warped 3D field -> flowing liquid filaments
      'float liquid(vec3 p){\n' +
      '  float t = u_time * LSPEED;\n' +
      '  p *= LSCALE;\n' +
      '  p.xy *= rot(t * 0.15);\n' +
      '  p.yz *= rot(t * 0.10);\n' +
      '  vec3 w = vec3(fbm3(p + t * 0.2), fbm3(p + vec3(4.3, 1.2, -t * 0.15)), fbm3(p.zxy + vec3(7.7, 2.3, t * 0.10)));\n' +
      '  return fbm3(p + 1.8 * w);\n' +
      '}\n' +
      'void main(){\n' +
      '  vec2 p = v_uv * 2.0 - 1.0;\n' +
      '  p.x *= u_res.x / u_res.y;\n' +
      '  vec3 ro = vec3(0.0, 0.0, 3.0);\n' +
      '  vec3 rd = normalize(vec3(p, -1.8));\n' +
      // raymarch; track closest approach so the glow stays OUTSIDE the orb
      '  float t = 0.0;\n' +
      '  bool hit = false;\n' +
      '  vec3 pos = ro;\n' +
      '  float minD = 1e3;\n' +
      '  for (int i = 0; i < 160; i++) {\n' +
      '    pos = ro + rd * t;\n' +
      '    float d = mapBlob(pos);\n' +
      '    minD = min(minD, d);\n' +
      '    if (d < 0.001) { hit = true; break; }\n' +
      '    t += d * 0.40;\n' +
      '    if (t > 6.0) break;\n' +
      '  }\n' +
      '  vec3 E = vec3(0.0);\n' +
      '  if (hit) {\n' +
      '    vec3 n = calcNormal(pos);\n' +
      '    vec3 v = -rd;\n' +
      '    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);\n' +
      // liquid interior: short volumetric march of swirling noise through the glass
      '    vec3 rp = pos + rd * 0.04;\n' +
      '    float trans = 1.0;\n' +
      '    vec3 inner = vec3(0.0);\n' +
      '    for (int k = 0; k < 10; k++) {\n' +
      '      float raw = liquid(rp);\n' +
      '      float dens = smoothstep(0.30, 0.70, raw);\n' +
      '      float fil = pow(1.0 - abs(2.0 * raw - 1.0), 5.0);\n' +
      '      vec3 c = mix(COL_B, COL_A, 0.5 + 0.5 * sin(raw * 6.0 + u_time * 0.3 + rp.y * 2.5));\n' +
      '      vec3 emit = c * dens * 0.55 + c * fil * FILAMENT + vec3(1.0) * pow(fil, 3.0) * FILAMENT * 0.4;\n' +
      '      emit += COL_A * smoothstep(0.5, 0.0, length(rp)) * CORE;\n' +
      '      inner += trans * emit * 0.17;\n' +
      '      trans *= 0.84;\n' +
      '      rp += rd * 0.11;\n' +
      '      if (length(rp) > 1.0) break;\n' +
      '    }\n' +
      '    E += inner * (1.0 - fres * 0.6);\n' +
      // glassy rim + specular glints (front surface)
      '    vec3 rim = mix(COL_B, COL_A, 0.5 + 0.5 * (n.x * 0.7 + n.y * 0.45));\n' +
      '    E += rim * fres * 1.3;\n' +
      '    vec3 l1 = normalize(vec3(0.6, 0.85, 0.6));\n' +
      '    vec3 l2 = normalize(vec3(-0.7, 0.25, 0.55));\n' +
      '    vec3 h1 = normalize(l1 + v);\n' +
      '    vec3 h2 = normalize(l2 + v);\n' +
      '    E += vec3(1.0) * pow(max(dot(n, h1), 0.0), SHINE) * 1.3;\n' +
      '    E += vec3(0.98, 0.95, 0.86) * pow(max(dot(n, h2), 0.0), SHINE * 0.45) * 0.6;\n' +
      '  } else {\n' +
      // glow ONLY outside: brightest at the silhouette, radiating outward
      '    float g = exp(-minD * 5.5);\n' +
      '    float ang = atan(rd.y, rd.x);\n' +
      '    vec3 gc = mix(GLOW_A, GLOW_B, 0.5 + 0.5 * sin(ang * 3.0 + u_time * 0.5));\n' +
      '    E += (gc * g * 1.4 + vec3(1.0, 0.98, 0.90) * pow(g, 3.0) * 0.7) * GLOWSTR;\n' +
      '  }\n' +
      // brightness fades up with the materialize (clamped: the size
      // overshoot may push u_intro slightly past 1)
      '  E *= clamp(u_intro, 0.0, 1.0);\n' +
      // additive over the loader's ink — seamless on the dark boot screen
      '  gl_FragColor = vec4(clamp(BG + E, 0.0, 1.0), 1.0);\n' +
      '}';

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || 'orb shader compile failed');
      }
      return sh;
    }
    let program;
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'orb link failed');
      }
    } catch (e) {
      cv.style.display = 'none';
      return null;
    }
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uTime  = gl.getUniformLocation(program, 'u_time');
    const uRes   = gl.getUniformLocation(program, 'u_res');
    const uIntro = gl.getUniformLocation(program, 'u_intro');

    // Square canvas from the CSS box; modest caps — the raymarch is the only
    // thing on screen, but there's no need to burn GPU the hero will want.
    function resize() {
      const side = Math.min(
        Math.round((cv.clientWidth || 300) * Math.min(window.devicePixelRatio || 1, 1.25)),
        640
      );
      if (cv.width !== side || cv.height !== side) {
        cv.width = side; cv.height = side;
      }
      gl.viewport(0, 0, side, side);
    }

    let raf = 0;
    let alive = true;
    const t0 = performance.now();
    // Materialize: the blob inflates from a point over INTRO_MS with an
    // easeOutBack (~10% liquid overshoot), brightness fading up alongside
    // (the shader clamps u_intro for the emission fade).
    const INTRO_MS = 1400;
    const BACK_C1 = 1.70158, BACK_C3 = BACK_C1 + 1.0;
    function frame(now) {
      if (!alive) return;
      resize();
      const it = Math.min((now - t0) / INTRO_MS, 1);
      const intro = 1 + BACK_C3 * Math.pow(it - 1, 3) + BACK_C1 * Math.pow(it - 1, 2);
      gl.uniform1f(uTime, (now - t0) * 0.001);
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uIntro, intro);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // Context loss during boot → stop cleanly (browser clears to transparent;
    // the ring gauge + telemetry still carry the loader).
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      alive = false;
      cancelAnimationFrame(raf);
    });

    return {
      stop() {
        alive = false;
        cancelAnimationFrame(raf);
      }
    };
  }

  /* -------------------------------------------------------
     initPreloader — boot instrument / reveal.
     A dark sheet with the gooey-orb boot gauge, which lifts on
     a curved edge (an SVG <path> whose `d` is morphed) to
     uncover the hero. The hero's entrance animations (canvas
     fade-in, UI stagger, name draw-on, reel) are held until the
     sheet is ~70% lifted — a touch before it fully clears (see
     wakeHero) — so the construct-in overlaps the last of the
     rise and the hand-off reads as one smooth motion.
     rAF-driven; safety-timed.
     ------------------------------------------------------- */
  function initPreloader(bootReady) {
    bootReady = Promise.resolve(bootReady || null);
    const loader = document.getElementById('preloader');
    if (!loader) { startHeroReel(); return; }
    const stageEl = document.getElementById('preloaderStage');
    const pathEl  = document.getElementById('preloaderCurtainPath');
    // Wire the loader's ring gauge to the boot orchestrator (frames + assets
    // + WebGL warmups). READY_CAP bounds how long the curtain holds waiting
    // for readiness, so it can never hang on a bad connection.
    bootBarEl = document.getElementById('preloaderBar');
    bootPctEl = document.getElementById('preloaderPct');
    updateBootUI();
    const READY_CAP = 11000;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const timers = [];
    let done = false;
    let heroStarted = false;
    function kickHero() { if (heroStarted) return; heroStarted = true; startHeroReel(); }

    // Wake the hero: removing .is-pre-load fades the canvas in and fires the
    // UI stagger + name draw-on; kickHero() starts the character reel. Fired a
    // touch BEFORE the sheet finishes lifting so the entrance overlaps the last
    // of the rise and the whole hand-off reads as one continuous motion.
    let woke = false;
    function wakeHero() {
      if (woke) return;
      woke = true;
      document.body.classList.remove('is-pre-load');
      kickHero();
    }

    // Dark-sheet shape at progress p (0 = full cover, 1 = lifted clear
    // of the viewport). The lower edge is a shallow curve whose centre
    // trails the sides, so the sheet peels up like a soft arch.
    function arcD(p) {
      const edge = 112 - p * 140;   // 112 (covers) -> -28 (clear)
      const ctrl = edge + 26;       // curved lower edge (centre trails)
      return 'M -20 -120 H 120 V ' + edge.toFixed(2) +
             ' Q 50 ' + ctrl.toFixed(2) + ' -20 ' + edge.toFixed(2) + ' Z';
    }

    // The boot orb runs only while the loader is up; reduced-motion visitors
    // get the still gauge (the canvas is display:none there and never started).
    const orb = (reduceMotionMQ && reduceMotionMQ.matches)
      ? null
      : initGooeyOrb(document.getElementById('preloaderOrb'));
    function stopOrb() { if (orb) orb.stop(); }

    function finish() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      stopOrb();
      wakeHero();                                    // ensure the hero is awake (idempotent)
      document.body.style.overflow = prevOverflow;   // unlock scroll
      loader.classList.add('is--gone');
    }

    // Absolute last-resort safety — never leave the visitor stuck on the
    // loader even if the ready-gate + its cap both somehow fail.
    timers.push(setTimeout(finish, 18000));

    // Hold the curtain until the site is READY (frames + assets + WebGL warm),
    // then run cb — but never longer than READY_CAP so a slow/broken connection
    // can't hang the loader.
    let revealStarted = false;
    function whenReady(cb) {
      let fired = false;
      const go = () => { if (fired) return; fired = true; cb(); };
      bootReady.then(go, go);
      timers.push(setTimeout(go, READY_CAP));
    }
    function gatedReveal() {
      whenReady(() => { if (revealStarted) return; revealStarted = true; beginReveal(); });
    }

    // Reduced motion: still gauge, wake the hero, then hand off once
    // ready — no orb, no arc animation.
    if (reduceMotionMQ && reduceMotionMQ.matches) {
      wakeHero();
      whenReady(finish);
      return;
    }

    // Minimum time the boot instrument is on screen — fast loads shouldn't
    // blink the orb away before it has read as an intentional moment.
    const MIN_HOLD = 1600, REVEAL_MS = 1500;

    // Lift the sheet off the hero. It stays dormant for most of the rise
    // (clean cream stage + halo), then wakes once the sheet is ~70% lifted —
    // a touch before it fully clears — so the canvas fade + UI construct-in
    // overlap the last of the rise and the hand-off reads as one smooth motion.
    function beginReveal() {
      loader.style.background = 'transparent';          // only the curtain covers now
      if (stageEl) stageEl.classList.add('is--out');    // fade the orb + gauge as one
      timers.push(setTimeout(stopOrb, 500));            // then park its render loop

      // Strong ease-in-out (slow ends, quick middle) ~ cubic-bezier(0.85,0,0.15,1).
      const ease = (t) => (t < 0.5 ? 16 * t * t * t * t * t
                                   : 1 - Math.pow(-2 * t + 2, 5) / 2);
      const WAKE_AT = 0.7;   // visual progress at which the hero begins its entrance
      const t0 = performance.now();
      (function raf(now) {
        const p = Math.min((now - t0) / REVEAL_MS, 1);
        const v = ease(p);
        if (pathEl) pathEl.setAttribute('d', arcD(v));
        if (v >= WAKE_AT) wakeHero();                   // start the entrance before the sheet clears
        if (p < 1) requestAnimationFrame(raf);
        else finish();
      })(performance.now());
    }

    // Give the instrument its minimum on-screen moment, then hold for
    // readiness (bar reaching 100% / READY_CAP) and lift.
    timers.push(setTimeout(gatedReveal, MIN_HOLD));
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
     - 9 category headings (big stroke text) interleaved with
       their skill cards, plus drifting starfield particles.
     - cameraZ is driven by the section's scroll progress
       (ScrollTrigger.scrub: 0.6) so the world flies past the
       viewer as they scroll through the pinned runway.
     - Camera tilts subtly with cursor; scroll velocity bends
       the perspective (warp feel) and stretches stars.
     - rAF render loop self-suspends when the section is not
       in view to avoid burning frames on hidden 3D.
     ------------------------------------------------------- */
  // Bridge: the warp shares its live camera Z + the dedicated gallery frame's
  // virtual depth; the gallery uses them to drive its LIVE pin (one continuous
  // element — no screenshot) with the IDENTICAL warp-frame physics: it emerges
  // from depth, reaches the front, then expands to full screen. `paintGallery`
  // is set by initProjectsHall and called every warp render frame.
  const warpBridge = { paintGallery: null, galleryBaseZ: 0, expandDepth: 5000 };
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
      { type: 'card',  cat: '01', name: 'JavaScript',   sub: 'Modern ES, async, DOM craft.',           meta: 'WEB · NODE' },
      { type: 'card',  cat: '01', name: 'Python',       sub: 'ML pipelines, scrapers, scripts.',       meta: 'ML · DATA' },
      { type: 'card',  cat: '01', name: 'Java',         sub: 'Production backend services.',           meta: 'REST · JVM' },
      { type: 'card',  cat: '01', name: 'C',            sub: 'Pointers, memory, systems basics.',      meta: 'NATIVE' },
      { type: 'card',  cat: '01', name: 'C++',          sub: 'SimX VR physics, low-level work.',       meta: 'NATIVE · OOP' },
      { type: 'card',  cat: '01', name: 'C#',           sub: '.NET services + Unity scripting.',       meta: '.NET · UNITY' },
      { type: 'card',  cat: '01', name: 'HTML',         sub: 'Semantic, accessible markup.',           meta: 'WEB' },

      { type: 'heading', text: 'FRAMEWORKS', cat: '02' },
      { type: 'card',  cat: '02', name: 'React',        sub: 'Components, hooks, suspense.',           meta: '5 YRS' },
      { type: 'card',  cat: '02', name: 'Next.js 15',   sub: 'App router, RSC, edge runtimes.',        meta: 'REACT · RSC' },
      { type: 'card',  cat: '02', name: 'Node.js',      sub: 'APIs, workers, tooling.',                meta: 'RUNTIME' },
      { type: 'card',  cat: '02', name: 'Tailwind CSS', sub: 'Design tokens at the source.',           meta: 'UTILITY' },
      { type: 'card',  cat: '02', name: 'CSS',          sub: 'Layout, motion, 3D transforms.',         meta: 'STYLE' },
      { type: 'card',  cat: '02', name: 'FastAPI',      sub: 'Typed Python services, fast.',           meta: 'PYTHON · API' },
      { type: 'card',  cat: '02', name: 'REST APIs',    sub: 'Clean contracts, versioned.',            meta: 'HTTP' },
      { type: 'card',  cat: '02', name: '.NET',         sub: 'C# backends + tooling.',                 meta: 'C# · CLR' },
      { type: 'card',  cat: '02', name: 'Git / GitHub', sub: 'Branches, reviews, Actions.',            meta: 'VCS' },
      { type: 'card',  cat: '02', name: 'Hugging Face', sub: 'Models, datasets, pipelines.',           meta: 'HUB' },
      { type: 'card',  cat: '02', name: 'Tailscale',    sub: 'Private mesh networking.',               meta: 'VPN · MESH' },
      { type: 'card',  cat: '02', name: 'DSA',          sub: 'Structures + algorithms, solid.',        meta: 'BIG-O' },
      { type: 'card',  cat: '02', name: 'Convex',       sub: 'Real-time backend + sync.',              meta: 'LIVE · SYNC' },
      { type: 'card',  cat: '02', name: 'Framer Motion',sub: 'Spring physics for UI.',                 meta: 'ANIM' },
      { type: 'card',  cat: '02', name: 'Playwright',   sub: 'Scrape, test, automate.',                meta: 'E2E' },

      { type: 'heading', text: 'MACHINE LEARNING', lines: ['MACHINE', 'LEARNING'], cat: '03' },
      { type: 'card',  cat: '03', name: 'PyTorch',      sub: 'Custom training + inference.',           meta: 'TORCH' },
      { type: 'card',  cat: '03', name: 'TensorFlow',   sub: 'Production model pipelines.',            meta: 'KERAS' },
      { type: 'card',  cat: '03', name: 'Scikit-Learn', sub: 'Classic models, fast baselines.',        meta: 'SKLEARN' },
      { type: 'card',  cat: '03', name: 'ML Pipelines', sub: 'Ingest → score → ship.',                 meta: 'ETL' },
      { type: 'card',  cat: '03', name: 'Model Infer',  sub: 'Low-latency serving.',                   meta: 'INFER' },
      { type: 'card',  cat: '03', name: 'LLMs',         sub: 'Scoring, extraction, generation.',       meta: 'GEN AI' },
      { type: 'card',  cat: '03', name: 'RAG',          sub: 'Semantic search, grounded answers.',     meta: 'EMBEDDING' },
      { type: 'card',  cat: '03', name: 'Vector DBs',   sub: 'Embeddings indexed for recall.',         meta: 'ANN' },

      { type: 'heading', text: 'AGENTIC AI', cat: '04' },
      { type: 'card',  cat: '04', name: 'Claude Code',  sub: 'Agentic coding in the terminal.',        meta: 'AGENT' },
      { type: 'card',  cat: '04', name: 'Codex',        sub: 'Delegated coding tasks.',                meta: 'AGENT' },
      { type: 'card',  cat: '04', name: 'Cursor',       sub: 'AI-native editor workflow.',             meta: 'IDE' },
      { type: 'card',  cat: '04', name: 'MCP',          sub: 'Tools + context for models.',            meta: 'PROTOCOL' },
      { type: 'card',  cat: '04', name: 'AI Agents',    sub: 'Plan, call tools, loop.',                meta: 'AGENTIC' },
      { type: 'card',  cat: '04', name: 'Prompt Eng.',  sub: 'Structured, testable prompts.',          meta: 'PROMPTS' },
      { type: 'card',  cat: '04', name: 'OpenAI API',   sub: 'Streaming, tool use, citations.',        meta: 'STREAM' },

      { type: 'heading', text: 'BACKEND', cat: '05' },
      { type: 'card',  cat: '05', name: 'SQL',          sub: 'Joins, indexes, query tuning.',          meta: 'QUERY' },
      { type: 'card',  cat: '05', name: 'PostgreSQL',   sub: 'Relational core of the stack.',          meta: 'POSTGRES' },
      { type: 'card',  cat: '05', name: 'Supabase',     sub: 'Auth + Postgres at the edge.',           meta: 'BAAS' },
      { type: 'card',  cat: '05', name: 'MongoDB',      sub: 'Document stores, flexible schemas.',     meta: 'NOSQL' },
      { type: 'card',  cat: '05', name: 'DB Design',    sub: 'Schemas, normalisation, keys.',          meta: 'MODEL' },
      { type: 'card',  cat: '05', name: 'Distributed Sys', sub: 'Queues, replicas, consistency.',      meta: 'SCALE' },
      { type: 'card',  cat: '05', name: 'SSR',          sub: 'Server-rendered, fast first paint.',     meta: 'RENDER' },
      { type: 'card',  cat: '05', name: 'ASP.NET Core', sub: 'C# web APIs + services.',                meta: '.NET · WEB' },

      { type: 'heading', text: 'CLOUD / DEVOPS', lines: ['CLOUD /', 'DEVOPS'], cat: '06' },
      { type: 'card',  cat: '06', name: 'AWS',          sub: 'EC2 · S3 · Lambda · IAM.',               meta: 'PROD' },
      { type: 'card',  cat: '06', name: 'EC2',          sub: 'Compute, sized to the load.',            meta: 'VM' },
      { type: 'card',  cat: '06', name: 'S3',           sub: 'Object storage at scale.',               meta: 'BUCKET' },
      { type: 'card',  cat: '06', name: 'Lambda',       sub: 'Serverless event workers.',              meta: 'FAAS' },
      { type: 'card',  cat: '06', name: 'IAM',          sub: 'Least-privilege roles, scoped.',         meta: 'POLICY' },
      { type: 'card',  cat: '06', name: 'Docker',       sub: 'Container ship to anywhere.',            meta: 'OCI' },
      { type: 'card',  cat: '06', name: 'CI / CD',      sub: 'GitHub Actions pipelines.',              meta: 'GREEN' },
      { type: 'card',  cat: '06', name: 'Azure',        sub: 'Cloud services, .NET-native.',           meta: 'CLOUD' },

      { type: 'heading', text: 'MOBILE', cat: '07' },
      { type: 'card',  cat: '07', name: 'Swift',        sub: 'Native iOS, SwiftUI.',                   meta: 'APPLE' },
      { type: 'card',  cat: '07', name: 'Kotlin',       sub: 'Native Android, Compose.',               meta: 'JVM' },
      { type: 'card',  cat: '07', name: 'React Native', sub: 'One codebase, two platforms.',           meta: 'CROSS' },
      { type: 'card',  cat: '07', name: 'Flutter',      sub: 'Dart UI, pixel-consistent.',             meta: 'CROSS' },
      { type: 'card',  cat: '07', name: 'iOS',          sub: 'Xcode, App Store builds.',               meta: 'APPLE' },
      { type: 'card',  cat: '07', name: 'Android',      sub: 'Gradle, Play Store builds.',             meta: 'GOOGLE' },

      { type: 'heading', text: 'PLATFORMS', cat: '08' },
      { type: 'card',  cat: '08', name: 'Linux',        sub: 'Shell, servers, daily ops.',             meta: 'UNIX' },
      { type: 'card',  cat: '08', name: 'Windows',      sub: 'Dev + .NET tooling.',                    meta: 'WIN' },
      { type: 'card',  cat: '08', name: 'macOS',        sub: 'Xcode + iOS builds.',                    meta: 'UNIX' },

      { type: 'heading', text: 'CRAFT', cat: '09' },
      { type: 'card',  cat: '09', name: 'UI / UX',      sub: 'Pixel-precise interfaces.',              meta: 'FIGMA' },
      { type: 'card',  cat: '09', name: 'Blender',      sub: '15K+ subs on 3D animation.',             meta: '3D' },
      { type: 'card',  cat: '09', name: 'Adobe CC',     sub: '50+ motion graphics shipped.',           meta: 'MOTION' },
      { type: 'card',  cat: '09', name: 'Unreal Engine',sub: 'Cinematic real-time scenes.',            meta: 'UE5' },
      { type: 'card',  cat: '09', name: 'Unity',        sub: 'VR training environments.',              meta: 'XR' },
      { type: 'card',  cat: '09', name: 'Motion',       sub: 'Springs, eases, scroll.',                meta: 'GSAP' }
    ];

    const Z_GAP       = 620;   // tighter than the old 800 so ~78 items fit a 900vh scrub
    // Large field, but cheap: paintItems skips faded-out stars, so per-frame
    // cost scales with VISIBLE stars only (a small fraction at any moment),
    // and stars carry no box-shadow — lighter than the old smaller field.
    // Still trimmed under perf-lite (?lite=1 / adaptive FPS probe) for weak HW.
    const STAR_COUNT  = document.body.classList.contains('perf-lite') ? 600 : 1300;
    const TOTAL_Z     = SKILLS.length * Z_GAP;
    // The camera flies through the skill cards AND a project/gallery frame field
    // that follows them in the SAME 3D space (FRAME_FIELD below), ending in dark
    // just past the last frame — where the interactive gallery is landed on (one
    // continuous flythrough; no separate section, no crossfade).
    // Tight ending: the frame field starts ~one card-gap (Z_GAP) behind the last
    // skill card and spans FIELD_DEPTH before the gallery. All frames are UNIQUE
    // section/project captures (no duplicates).
    const FRAME_Z0     = TOTAL_Z;          // field starts exactly one card-gap behind the last card
    const FIELD_DEPTH  = 3120;             // depth span of the frame field (kept = old 6×520 so the timeline is unchanged)
    // The gallery's LIVE pin behaves as a virtual frame at G_BASEZ — just past the
    // field, dead-centre. The warp shares cameraZ + G_BASEZ so the gallery drives that
    // live pin with the same perspective/alpha as the real frames (emerge → front at
    // vizZ=0), then EXPANDS over EXPAND_DEPTH of camera travel to full screen.
    const G_BASEZ      = -(FRAME_Z0 + FIELD_DEPTH);
    const EXPAND_DEPTH = 3000;            // camera travel from the front → full-screen gallery (tighter = expands sooner)
    const CAMERA_END   = -G_BASEZ + EXPAND_DEPTH;
    warpBridge.galleryBaseZ = G_BASEZ;
    warpBridge.expandDepth  = EXPAND_DEPTH;
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
        if (data.lines) {
          // Long titles stack to two centred lines (one nowrap line would
          // overflow mobile). Space before <br> keeps textContent readable.
          h.className = 'warp-heading warp-heading--stack';
          h.innerHTML = data.lines.join(' <br>');
        } else {
          h.className = 'warp-heading';
          h.textContent = data.text;
        }
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
        // Fixed per-item step (the original 35-item spacing) so neighbours
        // keep their separation no matter how long the list grows.
        const angle = i * (Math.PI * 6 / 35);
        const x = Math.cos(angle) * (window.innerWidth  * 0.28);
        const y = Math.sin(angle) * (window.innerHeight * 0.28);
        const rot = (i * 47 % 30) - 15;   // deterministic small rotation
        item = { el, type: 'card', x, y, rot, baseZ: -i * Z_GAP };
      }
      items.push(item);
      world.appendChild(el);
    });

    // ---- "PROJECT GALLERY" divider title — a single warp-heading (same font,
    // colour, opacity, fade-in + perspective motion as the category headings)
    // dropped into the OTHERWISE-EMPTY Z-gap between the last skill card
    // (baseZ -(TOTAL_Z - Z_GAP)) and the first project frame (just past
    // -TOTAL_Z). It introduces the project sequence without adding any scroll
    // distance or shifting a single frame's depth — it purely fills dead space,
    // so it reaches the front right after the last card and the first frame
    // follows closely behind it (then it fades as the frames take over). Two
    // words → stacked to two centred lines (--pg), since one huge nowrap line
    // would overflow the viewport. NOT pushed to headingIndices, so the CAT
    // counter stays 05/05 (this is a transition title, not a skill category).
    {
      const el = document.createElement('div');
      el.className = 'warp-item';
      const h = document.createElement('div');
      h.className = 'warp-heading warp-heading--pg';
      h.innerHTML = 'Project <br>Gallery';   // space → textContent reads "Project Gallery"; the break still stacks it
      el.appendChild(h);
      items.push({ el, type: 'heading', x: 0, y: 0, rot: 0, baseZ: -(TOTAL_Z - Z_GAP * 0.5) });
      world.appendChild(el);
    }

    // ---- Project/gallery FRAME FIELD: a constellation of UNIQUE section/project
    // captures (NO duplicates) that continues the SAME 3D field right after the last
    // skill card. The camera flies THROUGH them exactly like the cards (same scrub,
    // starfield, HUD, depth-emergence). Each has its own depth (dz, within FIELD_DEPTH
    // so the timeline is unchanged) and a scattered x/y/rotation filling the whole
    // constellation (incl. the left/lower that used to read empty). `gallery` is NOT
    // here — it's the live pin that emerges + expands at the end.
    // x/y are viewport fractions (0 = centre; ±0.5 ≈ screen edge) applied before
    // the perspective projection, so a frame reads at fraction ~x of the width when
    // it crosses the front plane. To fill the WHOLE screen (not a centre-left band),
    // successive depths are scattered across all four quadrants + edge-centres, with
    // magnitudes pushed near the edges (a little corner bleed is intentional). `dz`
    // (depth / appearance order) is UNCHANGED so the flythrough timing is identical.
    // Every frame lives on the PERIMETER — the four corners, the four edge-centres,
    // and two held out near the upper-right / lower-left — so the constellation fills
    // the screen edge-to-edge AND the centre stays clear: the live gallery pin emerges
    // dead-centre (roughly one frame wide/tall) and no frame's box may intersect it.
    // Each position clears that centre box on at least one axis (corners on both;
    // edge-centres on their long axis). Consecutive `dz` values sit in opposite regions
    // so successive frames pop apart, never stacking. `dz` (timing) is UNCHANGED.
    const FRAME_FIELD = [
      // Every frame flies through one of the FOUR CORNERS, cycling TL → TR → BL → BR
      // as depth (dz) increases with even spacing. Because consecutive frames land in
      // different corners they never clip each other, and the LAST FOUR (one per corner)
      // frame the central gallery pin symmetrically as it emerges. Same-corner frames
      // are 4 steps (~1160 dz) apart, so the earlier one has faded/receded behind the
      // later one — a clean depth stack in that corner, not an overlap. Corners clear
      // the centre box on both axes. `dz` only sets timing; the field span is unchanged.
      { name: 'contact',    x: -0.34, y: -0.23, rot:  -8, dz:  400 },   // TL
      { name: 'xp2',        x:  0.34, y: -0.23, rot:  12, dz:  690 },   // TR
      { name: 'skills4',    x: -0.34, y:  0.23, rot: -10, dz:  980 },   // BL (CAT-04 CI/CD)
      { name: 'skills2',    x:  0.34, y:  0.23, rot:  10, dz: 1270 },   // BR
      { name: 'hero',       x: -0.34, y: -0.23, rot:  -8, dz: 1560 },   // TL
      { name: 'skills',     x:  0.34, y: -0.23, rot:   9, dz: 1850 },   // TR
      { name: 'experience', x: -0.34, y:  0.23, rot:  -5, dz: 2140 },   // BL
      { name: 'careerlens', x:  0.34, y:  0.23, rot:   6, dz: 2430 },   // BR
      { name: 'splitz',     x: -0.34, y: -0.23, rot: -11, dz: 2720 },   // TL
      { name: 'skills3',    x:  0.34, y: -0.23, rot:   7, dz: 3010 }    // TR (CAT-01 Languages)
    ];
    const frameBgEls = [];   // bg images assigned on approach (IO below)
    FRAME_FIELD.forEach((f) => {
      const el = document.createElement('div');
      el.className = 'warp-item';
      const fr = document.createElement('div');
      fr.className = 'warp-frame';
      // Don't fetch the ten section-frame JPGs (~3–4MB) during page load —
      // they'd compete with the hero image sequence for bandwidth + decode
      // time. The observer below assigns the real backgrounds once the
      // skills section is half a viewport away — still hundreds of vh of
      // flythrough before any frame becomes visible.
      fr.dataset.bg = 'section-frames/' + f.name + '.jpg?v=3';
      extraPreload.push(fr.dataset.bg);   // warm into cache during the loader
      frameBgEls.push(fr);
      el.appendChild(fr);
      items.push({
        el, type: 'card', rot: f.rot,
        x: f.x * window.innerWidth,
        y: f.y * window.innerHeight,
        baseZ: -(FRAME_Z0 + f.dz)
      });
      world.appendChild(el);
    });
    function loadFrameBgs() {
      frameBgEls.forEach((fr) => {
        if (fr.dataset.bg) { fr.style.backgroundImage = "url('" + fr.dataset.bg + "')"; delete fr.dataset.bg; }
      });
    }
    if ('IntersectionObserver' in window) {
      const frameWarm = new IntersectionObserver((es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        loadFrameBgs();
        frameWarm.disconnect();
      }, { rootMargin: '50% 0px' });
      frameWarm.observe(section);
    } else {
      loadFrameBgs();
    }

    // ---- The Project Gallery preview is NO LONGER a static DOM frame here (that
    // caused a visible screenshot→live swap). Instead the LIVE gallery pin itself
    // is driven as a virtual frame at G_BASEZ via `warpBridge.paintGallery(cameraZ)`
    // (called from the render loop below) — one continuous live element that emerges,
    // reaches the front, then expands to full screen. See initProjectsHall.

    /* Starfield — a richer, evenly-distributed field that now spans the
       ENTIRE flythrough: the skill-card runway AND the project/gallery
       frame field that follows it. Previously star depth stopped at
       TOTAL_Z (where the frame field begins), so the floating frames flew
       through empty black; now stars surround them at the same density as
       the rest of the scene, so the frames read as embedded in one space.
       Stars vary in size, brightness, opacity and depth for a 3D (not
       flat-wallpaper) feel. All visual properties are set once at creation;
       the per-frame loop only touches transform/opacity, and stars carry
       NO box-shadow (a blurred glow inflates each star's GPU layer far past
       its pixel size) — so the denser field stays cheap on the compositor. */
    // Depth span = skill-card runway (TOTAL_Z) + the frame field
    // (FRAME_Z0..FRAME_Z0+FIELD_DEPTH) + a tail that reaches past the last
    // frame to the gallery's arrival depth, so deep stars are still AHEAD of
    // the camera while it flies through the frames AND during the final
    // approach (they then fade with the backdrop as the gallery expands).
    const STAR_Z_SPAN = FRAME_Z0 + FIELD_DEPTH + 2600;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      const el = document.createElement('div');
      el.className = 'warp-star';

      // Bias toward small (power curve) so most stars read as fine points,
      // with occasional larger ones for variation. Brightness floor is high
      // (~0.88 alpha, nearly all stars at/near full) so the field reads bright
      // and luminous — brightness comes from ALPHA + SIZE + a near-white tint,
      // NOT a box-shadow glow. Dropping the glow is the main GPU win: a blurred
      // shadow inflates each star's composited layer to many times its pixel
      // area (VRAM + overdraw); flat round dots are cheap. Alpha/size are baked
      // in per-star (no extra layers, no per-frame cost) — safe to push bright.
      const size      = 1.6 + Math.pow(rnd(), 1.5) * 2.9;   // ~1.6 – 4.5 px (bigger → reads brighter)
      const baseAlpha = 0.88 + Math.pow(rnd(), 0.9) * 0.12; // ~0.88 – 1.0 (near-full, median ~0.95)
      const isAccent  = rnd() < 0.12;                       // ~12% extra-bright + a touch larger

      const px = (isAccent ? size + 0.9 : size).toFixed(2) + 'px';
      el.style.width  = px;
      el.style.height = px;
      if (isAccent) {
        // Extra-bright pure-white accents (no green; no glow — see above).
        el.style.background = 'rgba(255, 255, 254, ' + Math.min(1, baseAlpha + 0.1).toFixed(2) + ')';
      } else {
        el.style.background = 'rgba(252, 250, 244, ' + baseAlpha.toFixed(2) + ')';
      }

      world.appendChild(el);
      items.push({
        el, type: 'star',
        x: (rnd() - 0.5) * 3800,                  // wide spread — fills periphery + behind frames
        y: (rnd() - 0.5) * 3800,
        baseZ: -rnd() * STAR_Z_SPAN               // spans cards + frame field → even density throughout
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
        else if (item.type === 'star') {
          // Stars fade out fast once they pass the camera (vizZ > 0) instead
          // of being held at full opacity while perspective balloons them into
          // big, hard-edged near-camera quads. That cull keeps the GPU light
          // (no giant overdrawn layers) and the pass reads as a clean streak.
          alpha = vizZ > 0 ? Math.max(0, 1 - vizZ / 300) : 1;
        }
        else if (vizZ > 80) alpha = Math.max(0, 1 - (vizZ - 80) / 1600);
        else                   alpha = 1;
        if (alpha < 0) alpha = 0;
        // Invisible items: hide once, then skip the transform build + write
        // entirely. `visibility: hidden` (not just opacity 0) matters here —
        // an opacity-0 element that carries a 3D transform still produces a
        // compositor layer, and with ~2/3 of the 1300-star field faded out at
        // any moment the compositor was walking hundreds of dead layers on
        // every commit (traced: Layerize dominated the warp frame cost).
        // Hidden elements drop out of that walk entirely, so per-frame work
        // scales with VISIBLE items on both the main thread AND compositor.
        if (alpha <= 0) {
          if (item._lastOp !== '0') {
            item.el.style.opacity = '0';
            item.el.style.visibility = 'hidden';
            item._lastOp = '0';
          }
          continue;
        }
        // Write opacity only when it actually changed (most visible items hold
        // a steady 1 across frames) — avoids redundant style mutations.
        const op = alpha.toFixed(3);
        if (op !== item._lastOp) {
          if (item._lastOp === '0') item.el.style.visibility = '';
          item.el.style.opacity = op;
          item._lastOp = op;
        }

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
      // (the hero→skills reveal zone). Runs over 640vh now (was 500) — the
      // extra 140vh flies the camera through the project/gallery frame field
      // that follows the cards, keeping the per-vh speed the same as before
      // (so the skill-card timing is unchanged) while extending the flythrough.
      gsap.to(state, {
        cameraZ: CAMERA_END,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: () => 'top+=' + window.innerHeight + ' top',
          end:   () => '+=' + (window.innerHeight * 9.0),   // 900vh scrub — keep in sync with .warp height (100 + 900 + 100)
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

      // (The gallery's fixed full-screen pin covers the warp during the intro,
      // and its fly-in scene reproduces this same dark + starfield + glow
      // backdrop — so the skills background reads as CONTINUED into the gallery
      // intro rather than cut. No warp fade needed.)
    } else {
      // Fallback: position items at static spiral, no camera motion.
      state.visible = false;
      items.forEach((item) => {
        item.el.style.visibility = '';   // undo any paintItems cull (static view shows all)
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

    // Off-stage culling: while the skills section is nowhere near the
    // viewport, hide the 3D world (visibility — not display, so no layout
    // shift) and its ~1300 star/card elements drop out of the compositor's
    // per-commit work. With them live, EVERY page commit — even while idling
    // in the hero — walked that whole layer list (traced: Layerize+Commit
    // were ~40% of hero frame time on a throttled CPU). The 75% rootMargin
    // restores it well before the hero→skills reveal can expose the scene,
    // so nothing ever pops on screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        const on = es.some((e) => e.isIntersecting);
        world.style.visibility = on ? '' : 'hidden';
      }, { rootMargin: '75% 0px' }).observe(section);
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
    let lastFov = '';
    let lastVelStr = '';
    let lastCoordStr = '';
    let lastCatStr = '';

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

      // Dynamic perspective — closer FOV when scrolling fast (warp feel).
      // Write only on change: an unconditional perspective write invalidates
      // style for EVERY 3D child (1300+ stars) even on frames where the
      // value is identical (e.g. while velocity sits at the cap).
      const fov = (1000 - Math.min(Math.abs(state.velocity) * 6, 450)).toFixed(0);
      if (fov !== lastFov) {
        viewport.style.perspective = fov + 'px';
        lastFov = fov;
      }

      // HUD — write only when the rendered string actually changed (each
      // textContent set replaces the text node and dirties layout).
      if (velEl) {
        const velStr = Math.abs(state.velocity).toFixed(2);
        if (velStr !== lastVelStr) { velEl.textContent = velStr; lastVelStr = velStr; }
      }
      if (coordEl) {
        const coordStr = Math.abs(state.cameraZ).toFixed(0).padStart(6, '0');
        if (coordStr !== lastCoordStr) { coordEl.textContent = coordStr; lastCoordStr = coordStr; }
      }
      if (catEl) {
        // current heading index based on cameraZ (no loop)
        const clampedZ = Math.max(0, Math.min(state.cameraZ, TOTAL_Z));
        let active = 0;
        for (let h = 0; h < headingIndices.length; h++) {
          if (clampedZ >= headingIndices[h] * Z_GAP - Z_GAP * 0.5) active = h;
        }
        const catStr =
          String(active + 1).padStart(2, '0') + ' / ' +
          String(headingIndices.length).padStart(2, '0');
        if (catStr !== lastCatStr) {
          catEl.textContent = catStr;
          lastCatStr = catStr;
        }
      }

      // Item transforms — shared with the initial-frame paint so the
      // first scrolled-into-view state matches the composed pose
      // exactly (no flash of a different card on top).
      paintItems(state.cameraZ, state.velocity, time * 0.001);

      // Drive the LIVE gallery pin as the final virtual frame (emerge → expand),
      // one continuous element, using the same camera Z as everything else.
      if (warpBridge.paintGallery) warpBridge.paintGallery(state.cameraZ, state.velocity, time * 0.001);

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
    const hallPin      = section.querySelector('.hall__pin');
    const reduceMotion = !!(reduceMotionMQ && reduceMotionMQ.matches);

    const SLIDE_COUNT = 3;
    const SPACING_X   = 45;     // 3D units between paintings
    const P_WIDTH     = 14;
    const P_HEIGHT    = 18;
    const CAM_Z       = 30;
    const WALL_ANGLE  = -0.25;  // wall recedes to the right
    // Dark room (ALCHE restyle): fog fades distant paintings + the wall
    // grid into near-black, matching the pin's ink background.
    const BG_HEX      = 0x0C0C0A;

    // Placeholder painting images — abstract / tech-feel covers
    // for each project card. Swap with real shots later.
    const IMAGES = [
      'https://images.unsplash.com/photo-1535378917042-10a22c95931a?w=900&q=80', // 0 STEALTH (video fallback)
      'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=900&q=80', // 1 SPLITZ
      'https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=900&q=80'     // 2 PEERCONNECT (video fallback)
    ];
    // A few project planes show a looping video instead of a still image
    // (index → src). The video is rendered as a THREE.VideoTexture on the
    // SAME plane, so the shadow + outline + perspective are unchanged.
    // NOTE: these filenames must match the git-committed case EXACTLY or they 404
    // on case-sensitive hosts (Vercel/Linux) while working on Windows. git tracks
    // 'Splitz.mp4' / 'Peerconnect.mp4' capitalized (a Windows case-rename git never
    // recorded) but 'stealth.mp4' lowercase — hence the mixed case here. Verify with
    // `git ls-files Project-gallery-videos` before changing.
    const VIDEO_SRC = {
      0: 'Project-gallery-videos/stealth.mp4',
      1: 'Project-gallery-videos/Splitz.mp4',
      2: 'Project-gallery-videos/Peerconnect.mp4'
    };
    // Hovering a video plane shows a live link-preview card (vanilla port of
    // the Aceternity LinkPreview) and clicking it opens the URL.
    const VIDEO_LINK = { 0: 'https://www.trystealth.org/' };
    const hoverTargets = [];    // { mesh, url } for raycast hover/click
    const VIDEO_SCALE = 1.6;    // video plane width vs a normal painting (P_WIDTH)
    const VIDEO_DX    = -1.6;   // shift left (world units) so the bigger plane grows into
                                // the centre gap — clear of the text panel and the right edge
    const videoEls = [];        // <video> elements (for play/pause)
    const videoTextures = [];   // their VideoTextures (uploaded only while their plane is near view)
    const videoMeshes = [];     // the plane mesh per video (for the visibility test)
    const videoNear = [];       // per-video "near the camera view" state (hysteresis)
    const _vNdc = new THREE.Vector3();   // scratch for the per-frame projection
    let videoOnScreen = false;  // gallery pin (with a video) is in view → keep rendering

    const scene = new THREE.Scene();
    // Transparent scene background (renderer alpha:true) so the pin's
    // dark-room backdrop (.hall__backdrop: ambient project clip + ink
    // vignette) shows through the canvas. Fog fades distant paintings
    // and the wall grid toward the same ink (BG_HEX).
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

    // ---- In-scene perspective grid (ALCHE-style dark wall) ----
    // TWO independent planes INSIDE galleryGroup, just behind the
    // paintings. Because they live in the same rotated group and are
    // drawn by the same camera, their perspective matches the video
    // planes EXACTLY and they pan 1:1 with the camera:
    //   • linesTex/gridMesh — the check lattice. NO drift of its own:
    //     welded to the wall, so it stays stuck to the videos.
    //   • plusTex/plusMesh — the plus markers only, drifting fast on
    //     their own clock (texture offset in render()).
    // Fog fades both into the dark.
    function makeGridTile(draw) {
      const T = 264;                      // one tile = 3 × 88px cells
      const c = document.createElement('canvas');
      c.width = T; c.height = T;
      draw(c.getContext('2d'), T);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    }
    const linesTex = makeGridTile((g, T) => {
      g.strokeStyle = 'rgba(236, 231, 218, 0.34)';
      g.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        const p = Math.min(i * 88 + 0.5, T - 0.5);
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, T); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(T, p); g.stroke();
      }
    });
    const plusTex = makeGridTile((g) => {
      // One plus per tile (= every 3rd intersection on the wall).
      g.strokeStyle = 'rgba(236, 231, 218, 0.8)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(88, 77); g.lineTo(88, 99);
      g.moveTo(77, 88); g.lineTo(99, 88);
      g.stroke();
    });
    const GRID_TILE_W = 9;                // world units per tile (3u cells)
    const GRID_W = SPACING_X * SLIDE_COUNT + 170;   // cover the pan + margins
    const GRID_H = 130;
    linesTex.repeat.set(GRID_W / GRID_TILE_W, GRID_H / GRID_TILE_W);
    plusTex.repeat.set(GRID_W / GRID_TILE_W, GRID_H / GRID_TILE_W);
    const gridGeo = new THREE.PlaneGeometry(GRID_W, GRID_H);
    const gridMesh = new THREE.Mesh(
      gridGeo,
      new THREE.MeshBasicMaterial({
        map: linesTex, transparent: true, opacity: 0.9, depthWrite: false
      })
    );
    gridMesh.position.set(SPACING_X, 0, -12);   // centred over the wall, behind the planes
    gridMesh.renderOrder = -2;
    galleryGroup.add(gridMesh);
    const plusMesh = new THREE.Mesh(
      gridGeo,
      new THREE.MeshBasicMaterial({
        map: plusTex, transparent: true, opacity: 0.9, depthWrite: false
      })
    );
    plusMesh.position.set(SPACING_X, 0, -11.5); // a hair in front of the lattice
    plusMesh.renderOrder = -1;
    galleryGroup.add(plusMesh);

    const loader   = new THREE.TextureLoader();
    const planeGeo = new THREE.PlaneGeometry(P_WIDTH, P_HEIGHT);
    const lineMat  = new THREE.LineBasicMaterial({ color: 0xDED7C8 });
    // Wall seam lines read as stray light diagonals in the dark room —
    // keep the material driveable (paintCollage writes its opacity) but
    // never draw it.
    lineMat.visible = false;
    // Light plane edging (was 0x222222 ink) — on the dark wall the
    // screens carry a thin light border like the reference.
    const outlineMat = new THREE.LineBasicMaterial({ color: 0xE8E3DA });

    const paintingGroups = [];
    for (let i = 0; i < SLIDE_COUNT; i++) {
      const g = new THREE.Group();
      g.position.set(i * SPACING_X, 0, 0);

      const mat  = new THREE.MeshBasicMaterial({ color: 0xe8e3d6 });
      const mesh = new THREE.Mesh(planeGeo, mat);
      let vidEl = null;
      if (VIDEO_SRC[i] && typeof THREE.VideoTexture === 'function') {
        // Looping muted video on this plane (same geometry/shadow/outline).
        const vid = document.createElement('video');
        vid.src = VIDEO_SRC[i];
        vid.loop = true;
        vid.muted = true; vid.defaultMuted = true;
        vid.playsInline = true;
        vid.setAttribute('playsinline', '');
        vid.setAttribute('webkit-playsinline', '');
        vid.setAttribute('muted', '');
        // metadata-only at page load: the three clips are ~19MB combined and
        // used to download (and even start decoding) while the HERO was still
        // fetching its image sequence. A one-shot observer on #skills flips
        // them to preload='auto' with a full flythrough of lead time, and the
        // render loop starts playback per-plane as each one nears the view.
        vid.preload = 'metadata';
        const vtex = new THREE.VideoTexture(vid);
        vtex.minFilter = THREE.LinearFilter;
        vtex.magFilter = THREE.LinearFilter;
        vtex.generateMipmaps = false;
        if (THREE.sRGBEncoding) vtex.encoding = THREE.sRGBEncoding;
        mat.map = vtex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        videoEls.push(vid);
        videoTextures.push(vtex);
        videoMeshes.push(mesh);
        videoNear.push(false);
        vidEl = vid;
      } else {
        loader.load(IMAGES[i] || IMAGES[0], (tex) => {
          if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        });
      }

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(planeGeo), outlineMat
      );

      const shadowMat  = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.12
      });
      const shadow = new THREE.Mesh(planeGeo, shadowMat);
      shadow.position.set(0.8, -0.8, -0.5);

      // Resize a video plane to the clip's native aspect ratio (keep the
      // painting width, derive the height) once the metadata is known —
      // so the footage isn't squished into the portrait frame. The shared
      // planeGeo is left intact (other paintings use it); this plane gets
      // its own geometry. Outline + shadow follow the new shape.
      if (vidEl) {
        // Bigger than a normal painting, and shifted left so it fills the
        // empty centre rather than running off the right edge.
        mesh.position.x   = VIDEO_DX;
        outline.position.x = VIDEO_DX;
        shadow.position.set(0.8 + VIDEO_DX, -0.8, -0.5);
        if (VIDEO_LINK[i]) hoverTargets.push({ mesh, url: VIDEO_LINK[i] });
        const fitVideoAspect = () => {
          if (!vidEl.videoWidth || !vidEl.videoHeight) return;
          const w = P_WIDTH * VIDEO_SCALE;
          const h = w * (vidEl.videoHeight / vidEl.videoWidth);
          const ng = new THREE.PlaneGeometry(w, h);
          mesh.geometry   = ng;            // (don't dispose planeGeo — it's shared)
          shadow.geometry = ng;
          const prevOutline = outline.geometry;
          outline.geometry  = new THREE.EdgesGeometry(ng);
          prevOutline.dispose();           // per-painting EdgesGeometry — safe to free
          kickRender();
        };
        if (vidEl.readyState >= 1) fitVideoAspect();
        else vidEl.addEventListener('loadedmetadata', fitVideoAspect, { once: true });
      }

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

    // The CENTRE painting (project 0 = the gallery video) emerges with the SAME
    // distance-fade as the collage frames during the fly-in. Make its materials
    // transparent so paintCollage can fade them (the shared outline/line mats are
    // safe to drive here because the other paintings are hidden during the fly-in;
    // they're restored to full for the pan). children = [shadow, mesh, outline, lines].
    const c0Shadow = paintingGroups[0].children[0].material;   // base opacity 0.12
    const c0Mesh   = paintingGroups[0].children[1].material;   // the video
    c0Mesh.transparent = true;
    outlineMat.transparent = true;
    lineMat.transparent = true;

    // ---- Gallery DISCOVERED as one warp frame, then EXPANDS (end of the flythrough) ----
    // No video, no zoom, no crossfade-to-another-scene. The LIVE gallery pin is
    // shown SMALL — the same size/format as the other warp frames — off-centre with
    // perspective tilt, while the real frame field is still flying past (the intro
    // starts BEFORE the scrub ends, so it's discovered among them). As you scroll it
    // grows past the others, aligns flat & centred, then EXPANDS to fill the
    // viewport = the real full-screen gallery growing out of the warp. The emerge
    // is a REAL warp frame (identical physics); this intro only hands off at the
    // front and expands the live pin from that frame's rect (see updateIntro).
    const INTRO_FRAMES = [];
    const collageGroup  = new THREE.Group();
    scene.add(collageGroup);
    const collagePlanes = [];
    INTRO_FRAMES.forEach((f) => {
      const w = f.s, h = f.s * 9 / 16;
      const geo = new THREE.PlaneGeometry(w, h);
      // Transparent + fog OFF: the frame's own per-distance OPACITY (set in
      // updateIntro) handles its fade-in, so when it's far it's truly see-through
      // and the REAL skills scene shows behind it (no fogged-to-grey rectangle).
      const mat = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0, fog: false, depthWrite: false
      });
      loader.load(f.src, (tex) => {
        if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; kickRender();
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(f.x, f.y, f.z);
      collageGroup.add(mesh);
      collagePlanes.push({ mesh, mat, z: f.z });
    });

    // White starfield matching the skills warp's: fewer, small, varied-brightness
    // dots (the warp uses ~0.40–0.95 alpha) — sparse, not a dense field. No green.
    // Per-point brightness via vertexColors; depth size variety via sizeAttenuation.
    const starGeo = new THREE.BufferGeometry();
    const STAR_N  = 190;
    const starPos = new Float32Array(STAR_N * 3);
    const starCol = new Float32Array(STAR_N * 3);
    let _ss = 9173;
    const _rnd = () => { _ss = (_ss * 9301 + 49297) % 233280; return _ss / 233280; };
    for (let i = 0; i < STAR_N; i++) {
      starPos[i * 3]     = (_rnd() - 0.5) * 360;
      starPos[i * 3 + 1] = (_rnd() - 0.5) * 250;
      starPos[i * 3 + 2] = -40 + _rnd() * 360;            // along the fly-in path
      const v = 0.40 + _rnd() * 0.55;                      // matches the warp's alpha range
      starCol[i * 3] = v; starCol[i * 3 + 1] = v; starCol[i * 3 + 2] = v * 0.97;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color',    new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.15, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0, depthWrite: false, fog: false
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // Fly-in state, read by render(). The gallery now sits at its fixed arrival
    // pose throughout the intro (NO zoom / push-in), so these stay 0.
    let flyZ = 0;
    let introCamX = 0;
    const warpSecEl  = document.getElementById('skills');     // live skills backdrop (pin + its ink bg)
    const hallGlowEl = section.querySelector('.hall__glow');  // gallery's chartreuse accent glow
    const introHud   = section.querySelector('.hall__intro-hud');  // reproduced top/bottom HUD lines
    // ONE continuous LIVE element — no screenshot, no swap. The warp shares its
    // camera Z; here we drive the live gallery PIN as a virtual frame at G_BASEZ:
    // it EMERGES from depth with the exact warp-frame perspective + alpha (so it's
    // hidden far away and reveals only when close, like every other frame), reaches
    // the front (vizZ=0, frame size), then EXPANDS smoothly to full screen over the
    // next EXPAND_DEPTH of camera travel. The SAME pin (rendering the live gallery
    // the whole time) becomes the full-screen page — only its transform/opacity/size
    // change. Called every warp render frame via warpBridge.paintGallery.
    const G_PERSP = 1000;                  // == .warp__viewport perspective
    let galleryShown = false;              // pin currently revealed (vs hidden far away)
    function paintGallery(cameraZ) {
      if (reduceMotion || !hallPin) return;
      const vizZ = warpBridge.galleryBaseZ + cameraZ;
      // Emerge alpha — SAME ramp as the warp frames (no fade-out: it's the destination).
      let alpha;
      if (vizZ < -3200)      alpha = 0;
      else if (vizZ < -2200) alpha = (vizZ + 3200) / 1000;
      else                   alpha = 1;
      if (alpha <= 0.001) {                // far away / not yet emerged → hidden + not rendering
        if (galleryShown) {
          hallPin.style.opacity = '0';
          hallPin.classList.remove('hall__pin--fixed', 'hall__pin--frame');
          galleryShown = false;
        }
        return;
      }
      const vw = window.innerWidth;
      const gW = Math.min(Math.max(300, 0.28 * vw), 430) / vw;    // == the (bigger) warp frames' on-screen size
      const ED = warpBridge.expandDepth || 5000;
      let s, expandP = 0;
      if (vizZ <= 0) {                     // EMERGE — perspective grow, identical to a frame
        s = gW * (G_PERSP / (G_PERSP - vizZ));
      } else {                             // EXPAND — smooth grow to full screen
        expandP = Math.min(1, vizZ / ED);
        const ease = expandP * expandP * (3 - 2 * expandP);
        s = gW + (1 - gW) * ease;
      }
      if (s > 1) s = 1;
      if (!galleryShown) {
        hallPin.classList.add('hall__pin--fixed');
        hallPin.classList.remove('is-entering');
        hallPin.style.transformOrigin = '50% 50%';
        visible = true;
        galleryShown = true;
      }
      const rot = -4 * (1 - expandP);      // a frame's slight tilt → flat as it expands
      // White boundary at constant SCREEN width: box-shadow scales with the
      // pin's transform, so divide the target px by the scale each frame.
      hallPin.style.setProperty('--frame-ring', (2.5 / Math.max(s, 0.02)).toFixed(1) + 'px');
      hallPin.classList.toggle('hall__pin--frame', expandP < 0.92);
      hallPin.classList.toggle('hall__pin--clear', expandP >= 0.92);
      if (s >= 0.999) {
        hallPin.style.transform = '';      // full screen → untransformed real page
        const r = section.getBoundingClientRect();
        if (r.top <= 0.5) hallPin.classList.remove('hall__pin--fixed');  // sticky → the pan owns it
      } else {
        hallPin.style.transform = `rotateZ(${rot.toFixed(2)}deg) scale(${s.toFixed(4)})`;
      }
      hallPin.style.opacity = expandP > 0 ? '1' : alpha.toFixed(3);
      // Warp backdrop (stars/HUD/dark) fades only as the gallery expands.
      if (warpSecEl) warpSecEl.style.opacity = (1 - expandP * expandP * (3 - 2 * expandP)).toFixed(3);
      if (hallGlowEl) hallGlowEl.style.opacity = expandP.toFixed(3);
      kickRender();
    }
    warpBridge.paintGallery = paintGallery;

    // Static THREE state for the whole emerge+expand: the gallery renders project-0
    // at its arrival pose the entire time; only the pin's CSS transform changes.
    flyZ = 0; introCamX = 0;
    scene.background = null;
    scene.fog.color.set(BG_HEX); scene.fog.near = 14; scene.fog.far = 130;
    starMat.opacity = 0; starField.visible = false;
    if (introHud) introHud.style.opacity = '0';
    collageGroup.visible = false;
    c0Mesh.opacity = 1; c0Shadow.opacity = 0.12; outlineMat.opacity = 1; lineMat.opacity = 1;
    for (let i = 1; i < paintingGroups.length; i++) paintingGroups[i].visible = true;
    // Per-frame collage opacity (called from render so it tracks the live camera).
    // Each frame emerges from the FAR depth, holds, then fades as it flies past —
    // the same shape as the skill cards' alpha-by-distance, so they appear the
    // same way. FLY_DIST is large enough that at e=0 every frame is still beyond
    // the fade-in range (fully see-through) — they only appear as the camera
    // flies toward them, never popping in.
    function paintCollage() {
      const camZ = CAM_Z + flyZ;               // currentScroll ≈ 0 during the fly-in
      for (let i = 0; i < collagePlanes.length; i++) {
        const cp = collagePlanes[i];
        const dist = camZ - cp.z;
        let op;
        if (dist <= 5 || dist >= 230) op = 0;            // behind camera / too far → see-through
        else if (dist < 40)  op = (dist - 5) / 35;       // fades out as it flies past
        else if (dist <= 170) op = 1;
        else op = (230 - dist) / 60;                     // eases in from the far depth
        if (Math.abs(op - cp.mat.opacity) > 0.002) cp.mat.opacity = op;
        cp.mesh.visible = op > 0.001;
      }
      // Centre gallery video (project 0 at z=0): same emerge-from-depth fade, so
      // it appears like the other frames (then grows to fill as we arrive).
      const d0 = camZ;
      const o0 = d0 >= 230 ? 0 : d0 > 170 ? (230 - d0) / 60 : 1;
      c0Mesh.opacity   = o0;
      c0Shadow.opacity = 0.12 * o0;
      outlineMat.opacity = o0;
      lineMat.opacity    = o0;
    }
    // Initial gallery state: reduced motion → just the full page; otherwise hide the
    // pin (paintGallery reveals + grows it as the camera approaches, driven by the
    // warp render loop).
    if (reduceMotion) {
      hallPin.classList.add('hall__pin--clear');
      hallPin.classList.remove('is-entering');
      hallPin.style.transform = '';
      hallPin.style.opacity = '1';
    } else {
      paintGallery(0);
    }

    // Gate video work on the gallery pin being on screen at all. While on,
    // `videoOnScreen` keeps the render loop ticking and the per-plane gating
    // in render() decides WHICH clip actually plays + uploads (the visible
    // one) — the rest stay paused. Off screen, everything pauses so nothing
    // decodes in the background.
    if (videoEls.length && 'IntersectionObserver' in window) {
      const pinEl = section.querySelector('.hall__pin');
      if (pinEl) {
        new IntersectionObserver((entries) => {
          const on = entries.some((e) => e.isIntersecting);
          videoOnScreen = on;
          if (on) {
            kickRender();   // render() resumes the near-view clip(s)
          } else {
            videoEls.forEach((v, i) => { v.pause(); videoNear[i] = false; });
            // The backdrop mirror pauses with them (render() is about
            // to stop ticking, so the per-frame sync can't do it).
            if (bgVideo && !bgVideo.paused) bgVideo.pause();
          }
        }, { threshold: 0 }).observe(pinEl);
      }
    } else if (videoEls.length) {
      // No IntersectionObserver: keep them playing + rendering unconditionally.
      videoOnScreen = true;
      videoEls.forEach((v) => { const p = v.play(); if (p && p.catch) p.catch(() => {}); });
    }

    // Warm the clips while the user is still flying through the skills warp:
    // flip preload metadata → auto once #skills actually enters the viewport.
    // That still leaves ~7 viewports of flythrough before the first video
    // plane can appear, but it's late enough that the ~19MB of clips never
    // competes with the hero image sequence at page load. (No rootMargin —
    // the section overlaps the hero's tail, so any margin fires at the top.)
    if (videoEls.length && 'IntersectionObserver' in window) {
      const skillsSec = document.getElementById('skills');
      if (skillsSec) {
        const warm = new IntersectionObserver((es) => {
          if (!es.some((e) => e.isIntersecting)) return;
          videoEls.forEach((v) => { v.preload = 'auto'; try { v.load(); } catch (e) {} });
          warm.disconnect();
        }, { rootMargin: '0px' });
        warm.observe(skillsSec);
      }
    }

    // ---- Hover link-preview over the video plane(s) ----
    // Vanilla port of the Aceternity <LinkPreview>: because the "video" is a
    // WebGL plane (not a DOM node), we raycast the pointer against the plane to
    // detect hover, then float a DOM card showing a live microlink screenshot
    // of the URL; clicking the plane opens it. The card is pointer-events:none
    // so it never interferes with the canvas hit-testing.
    if (hoverTargets.length) {
      const card = document.createElement('a');
      card.className = 'lp-card';
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.setAttribute('aria-hidden', 'true');
      const frame = document.createElement('div');
      frame.className = 'lp-card__frame';
      const skel = document.createElement('div');
      skel.className = 'lp-card__skeleton';
      const cardImg = document.createElement('img');
      cardImg.className = 'lp-card__img';
      cardImg.alt = 'Live site preview';
      cardImg.decoding = 'async';
      frame.appendChild(skel);
      frame.appendChild(cardImg);
      card.appendChild(frame);
      // The card lives inside a "follow" wrapper: the wrapper is what trails
      // the cursor (damped-spring, so it lags slightly with a soft ease),
      // while the card itself runs the slow incoming animation. Keeping the
      // two on separate elements lets each have its own motion.
      const follow = document.createElement('div');
      follow.className = 'lp-follow';
      follow.appendChild(card);
      document.body.appendChild(follow);

      // Swap in a target's screenshot, showing the shimmer skeleton until it
      // decodes, then crossfading the image in. The screenshot is preloaded
      // (often already cached), so we hold the skeleton for a minimum time on
      // every open — otherwise the loading animation would flash by unseen.
      const LP_MIN_LOAD_MS = 1100;
      let loadSeq = 0;
      function loadPreview(url) {
        const seq = ++loadSeq;
        card.classList.remove('is-loaded');
        let decoded = false, waited = false;
        const reveal = () => { if (decoded && waited && seq === loadSeq) card.classList.add('is-loaded'); };
        cardImg.onload = () => { decoded = true; reveal(); };
        cardImg.onerror = () => { decoded = true; reveal(); }; // drop the skeleton either way
        cardImg.src = previewSrc[url];
        if (cardImg.complete && cardImg.naturalWidth > 0) decoded = true;
        setTimeout(() => { waited = true; reveal(); }, LP_MIN_LOAD_MS);
      }

      // Build + warm the microlink screenshot for each target.
      const previewSrc = {};
      hoverTargets.forEach((t) => {
        const params = [
          'url=' + encodeURIComponent(t.url),
          'screenshot=true', 'meta=false', 'embed=screenshot.url', 'colorScheme=light',
          'viewport.isMobile=true', 'viewport.deviceScaleFactor=1',
          'viewport.width=900', 'viewport.height=560'
        ].join('&');
        const s = 'https://api.microlink.io/?' + params;
        previewSrc[t.url] = s;
        const warm = new Image(); warm.src = s;   // preload so it's ready on hover
      });

      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const cvs = renderer.domElement;
      let hoverUrl = null;

      function pickTarget(e) {
        const r = cvs.getBoundingClientRect();
        ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(hoverTargets.map((t) => t.mesh), false)[0];
        return hit ? hoverTargets.find((t) => t.mesh === hit.object) : null;
      }
      // --- Cursor-follow with a damped spring (delay + speed curve) ---
      // The wrapper eases toward the cursor instead of snapping to it, so the
      // preview trails the pointer with a soft, weighted feel.
      const reduceM = !!(reduceMotionMQ && reduceMotionMQ.matches);
      const FOLLOW_STIFF = 0.07;   // lower = more lag / slower catch-up
      const FOLLOW_DAMP  = 0.74;   // lower = more damping (less overshoot)
      let fx = 0, fy = 0, tx = 0, ty = 0, fvx = 0, fvy = 0, followRAF = 0;
      function applyFollow() { follow.style.transform = 'translate3d(' + fx + 'px,' + fy + 'px,0)'; }
      function followTick() {
        followRAF = 0;
        fvx += (tx - fx) * FOLLOW_STIFF; fvx *= FOLLOW_DAMP; fx += fvx;
        fvy += (ty - fy) * FOLLOW_STIFF; fvy *= FOLLOW_DAMP; fy += fvy;
        applyFollow();
        if (Math.abs(tx - fx) > 0.1 || Math.abs(ty - fy) > 0.1 ||
            Math.abs(fvx) > 0.1 || Math.abs(fvy) > 0.1) {
          followRAF = requestAnimationFrame(followTick);
        }
      }
      function kickFollow() { if (!followRAF) followRAF = requestAnimationFrame(followTick); }
      function setTarget(e) {
        const cw = card.offsetWidth || 292, ch = card.offsetHeight || 215;
        tx = Math.max(cw / 2 + 10, Math.min(window.innerWidth - cw / 2 - 10, e.clientX));
        ty = Math.max(ch + 12, e.clientY - 20);    // anchor sits just above the cursor
      }

      cvs.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const t = pickTarget(e);
        if (t) {
          const wasOff = !card.classList.contains('is-on');
          if (hoverUrl !== t.url) {
            hoverUrl = t.url;
            card.href = t.url;
            loadPreview(t.url);
          }
          setTarget(e);
          if (wasOff || reduceM) { fx = tx; fy = ty; fvx = fvy = 0; applyFollow(); } // appear at cursor / snap
          card.classList.add('is-on');
          cvs.style.cursor = 'pointer';
          if (!reduceM) kickFollow();
        } else if (hoverUrl) {
          hoverUrl = null;
          card.classList.remove('is-on');
          cvs.style.cursor = '';
        }
      }, { passive: true });

      const clearHover = () => { hoverUrl = null; card.classList.remove('is-on'); cvs.style.cursor = ''; };
      cvs.addEventListener('pointerleave', clearHover);

      cvs.addEventListener('click', (e) => {
        const t = pickTarget(e);
        if (t) window.open(t.url, '_blank', 'noopener,noreferrer');
      });
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

    // --- Forward exit gate + recoil (used by the scroll-gate block at
    // the bottom of this function) ---
    // The page is NOT allowed to scroll out of the gallery until the
    // camera has actually SETTLED on the last project. A scroll violent
    // enough to outrun the camera is held at the section's exit edge;
    // while held, the camera position is driven by a damped spring
    // toward the last project. The blocked scroll injects an OUTWARD
    // velocity (`camVel`) so the camera shoots PAST the last project —
    // the painting slides out like the others did — then springs back
    // to center. Driving the camera's own position (not the lerp target)
    // gives the bounce a crisp, controllable settle instead of the slow
    // tail the normal scroll lerp would leave. Tunables below:
    let camVel       = 0;      // camera spring velocity (world units/frame) while holding
    let gateOpen     = false;  // forward exit allowed (camera settled on last project)
    let holding      = false;  // gate is actively pinning the page at the exit edge
    let settleFrames = 0;      // consecutive frames the recoil has rested on the last project
    let clampLockFn  = null;   // gate block wires this to its scroll-freeze clamp (called each frame)
    const HOLD_STIFF = 0.035;  // hold-spring stiffness (lower = slower, longer recoil)
    const HOLD_DAMP  = 0.86;   // per-frame velocity damping (higher = more bounce/oscillation)
    const REC_K      = 0.012;  // blocked-scroll px → outward kick velocity
    const REC_MAX    = 7;      // cap the per-kick velocity (a single kick peaks ≈ REC_OVER)
    const REC_OVER   = 38;     // hard cap on how far past the last project the camera may swing
    const SETTLE_EPS = 1.2;    // camera within this of last project = "caught up"
    const SETTLE_VEL = 0.35;   // recoil velocity below this counts toward "rested"
    const SETTLE_HOLD = 8;     // frames of continuous rest before the gate may open (debounce)

    // Update which slide-content panel is active based on
    // the camera's current horizontal position along the wall.
    let lastActiveIdx = -1;
    const slideEls = [];
    for (let i = 0; i < SLIDE_COUNT; i++) {
      slideEls.push(document.getElementById('hallSlide-' + i));
    }
    function updateUI(scrollX) {
      const raw  = Math.round(scrollX / SPACING_X);
      // Clamp (don't wrap) so the recoil overshoot past the last
      // project keeps the LAST panel active instead of flipping back
      // to the first one as the camera swings out beyond it.
      const idx  = Math.max(0, Math.min(SLIDE_COUNT - 1, raw));
      if (idx === lastActiveIdx) return;
      const prevIdx = lastActiveIdx;
      lastActiveIdx = idx;
      for (let i = 0; i < SLIDE_COUNT; i++) {
        if (!slideEls[i]) continue;
        slideEls[i].classList.toggle('is-active', i === idx);
      }
      // Clear any lingering title hover when the project changes, so the
      // newly-active title doesn't come up already lit / green just
      // because the cursor is parked where the previous title sat. The
      // `true` arms a brief hover-lock that swallows the synthetic
      // mouseenter the browser fires on the new title during the switch.
      document.querySelectorAll('.hall-slide .text-scramble').forEach(function (h) {
        if (h.resetScramble) h.resetScramble(true);
      });
      // Auto-run the scramble on the newly-active title so it animates
      // in on every switch. Skipped on the very first activation
      // (prevIdx === -1) — the gallery isn't on screen yet, so the
      // animation would just play unseen.
      if (prevIdx !== -1 && slideEls[idx]) {
        const host = slideEls[idx].querySelector('.text-scramble');
        if (host && host.runScramble) host.runScramble();
      }
    }
    // Activate first slide immediately so the panel is visible
    // when the section first scrolls into view.
    updateUI(0);

    // ---- Ambient backdrop video (.hall__backdrop) ----
    // Mirrors the ACTIVE project's clip as a faint fullscreen wash
    // behind the wall. Playback is gated on (a) the pin having arrived
    // (--clear — never during the dark fly-in intro), (b) the gallery
    // being on screen, and (c) not perf-lite. Called every render()
    // frame (cheap: two classList checks) so it reacts within a frame
    // of any gate flipping; the off-screen IO pauses it directly.
    // Src files are the same clips the wall plays, so they come from
    // the browser cache — no extra downloads.
    const bgVideo = document.getElementById('hallBgVideo');
    if (bgVideo) bgVideo.muted = true;
    let bgSrcIdx = -1;
    function syncBackdropVideo() {
      if (!bgVideo) return;
      const wantPlay = videoOnScreen &&
        hallPin.classList.contains('hall__pin--clear') &&
        !document.body.classList.contains('perf-lite');
      if (wantPlay && bgSrcIdx !== lastActiveIdx && VIDEO_SRC[lastActiveIdx]) {
        bgSrcIdx = lastActiveIdx;
        bgVideo.src = VIDEO_SRC[bgSrcIdx];
      }
      if (wantPlay && bgSrcIdx !== -1) {
        if (bgVideo.paused) { const p = bgVideo.play(); if (p && p.catch) p.catch(() => {}); }
      } else if (!bgVideo.paused) {
        bgVideo.pause();
      }
    }

    function render() {
      raf = 0;
      // Hard-pin the page at the exit edge every frame while frozen, so any
      // momentum/fling that leaked past overflow:hidden can't carry the page
      // away (clampLockFn is wired up by the gate block below).
      if (clampLockFn) clampLockFn();
      if (!visible && !holding && !videoOnScreen) {
        // Section left view: let any residual motion blur decay out.
        if (blurVel > 0.03) { blurVel *= 0.8; updateMotionBlur(blurVel); kickRender(); }
        else updateMotionBlur(0);
        return;
      }
      syncBackdropVideo();
      // Camera follow — a hold-spring while the exit gate is pinning the
      // page (recoil bounce), otherwise the normal eased scroll lerp. The
      // per-frame delta also drives the motion blur, so a fast catch-up
      // (or the recoil overshoot) smears the wall horizontally.
      if (holding) {
        // Hold-spring: a damped spring drives the camera position back to
        // the last project. The blocked scroll has injected an outward
        // `camVel`, so the camera first overshoots past the last project
        // (it slides out of frame like the others) then springs back to
        // center. Direct position control = a crisp recoil with a short,
        // tunable settle (no long scroll-lerp tail).
        camVel += (LAST_SCROLL - currentScroll) * HOLD_STIFF;
        camVel *= HOLD_DAMP;
        currentScroll += camVel;
        // Bound the outward swing so sustained hammering can't drive the
        // camera off into empty space — it pins at the cap, then springs
        // back once the input stops.
        const maxOut = LAST_SCROLL + REC_OVER;
        if (currentScroll > maxOut) { currentScroll = maxOut; if (camVel > 0) camVel = 0; }
        if (Math.abs(LAST_SCROLL - currentScroll) < 0.05 && Math.abs(camVel) < 0.05) {
          currentScroll = LAST_SCROLL; camVel = 0;
        }
        // Debounced "rested" detection: the gate may only open after the
        // recoil has sat on the last project for SETTLE_HOLD consecutive
        // frames. This stops the damped oscillation's velocity-reversal
        // peaks (which momentarily look settled) from releasing the lock
        // mid-bounce — the cause of the up/down jitter.
        if (Math.abs(LAST_SCROLL - currentScroll) < SETTLE_EPS && Math.abs(camVel) < SETTLE_VEL) {
          settleFrames++;
        } else {
          settleFrames = 0;
        }
      } else {
        // Eased follow — the camera lerps toward the scroll-driven target
        // so transitions between projects glide instead of locking 1:1 to
        // the scroll wheel.
        currentScroll += (targetScroll - currentScroll) * SCROLL_LERP;
        if (Math.abs(targetScroll - currentScroll) < 0.001) currentScroll = targetScroll;
      }
      const instVel = Math.abs(currentScroll - prevScroll);
      prevScroll = currentScroll;

      // Motion blur: snap up to the current velocity, then decay so
      // the horizontal smear trails off smoothly after scrolling stops
      // (and the wall resolves crisp on the project you land on).
      blurVel = Math.max(blurVel * 0.8, instVel);
      updateMotionBlur(blurVel);

      const xMove = currentScroll * Math.cos(WALL_ANGLE);
      const zMove = currentScroll * Math.sin(WALL_ANGLE);
      // `introCamX` centres project-0 while the camera is framed tight on it at
      // the start of the reveal, easing to 0 (gallery arrival) as we pull back.
      camera.position.x = xMove + introCamX;
      // `flyZ` is the camera's z-offset during the intro: negative (closer) at the
      // start so project-0's video fills the frame — matching the warp's filled
      // video card — then → 0 (arrival) as the camera pulls back to reveal the gallery.
      camera.position.z = CAM_Z - zMove + flyZ;

      camera.rotation.x = mouse.y * 0.04;
      camera.rotation.y = -mouse.x * 0.04;

      // While flying in, fade each collage frame by its distance so it emerges
      // from / passes through the live skills scene behind the transparent canvas.
      if (flyZ > 0.01) paintCollage();

      updateUI(currentScroll);
      // Per-plane video gating: a clip only plays (decodes) and re-uploads
      // its texture while ITS plane is near the camera's view. Paintings sit
      // ~2.0 NDC apart on the wall, so panning keeps ONE clip live and the
      // others paused on their last frame — previously all three decoded and
      // re-uploaded 1080p frames on every render. ON at |ndc|<1.6 pre-rolls
      // playback just before a plane's edge can enter the viewport (widest
      // plane edge shows at ~1.5); OFF at >1.85 stays under the 2.0 neighbour
      // distance, and the gap between the two avoids play/pause thrash.
      for (let i = 0; i < videoTextures.length; i++) {
        const v = videoEls[i];
        videoMeshes[i].getWorldPosition(_vNdc).project(camera);
        const ax = Math.abs(_vNdc.x);
        const near = videoOnScreen && (videoNear[i] ? ax < 1.85 : ax < 1.6);
        videoNear[i] = near;
        if (near) {
          if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
          if (v.readyState >= 2) videoTextures[i].needsUpdate = true;
        } else if (!v.paused) {
          v.pause();
        }
      }
      // Fast constant drift on the PLUS layer only (the check lattice
      // stays welded to the wall/videos). Horizontal right→left along
      // the wall plane, so it travels in the same perspective as the
      // lattice. One GPU uniform on a loop that's already ticking.
      // ~5.5s per tile.
      if (!reduceMotion) {
        plusTex.offset.x = (performance.now() * 0.00018) % 1;
      }
      renderer.render(scene, camera);

      // Keep ticking while the camera is still easing toward target
      // OR while motion blur is decaying — so both the pan and the
      // smear finish smoothly after scrolling stops.
      // Keep ticking continuously while a video is on screen so its texture
      // updates every frame — including across the loop seam (so it never
      // freezes on the last frame waiting for the next scroll to re-kick).
      if (currentScroll !== targetScroll || blurVel > 0.03 || (holding && currentScroll !== LAST_SCROLL) || videoOnScreen) kickRender();
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

    // ----- Boot warmup + graceful context-loss (gallery) -----
    // The most valuable warm on the page: fetch each project video's FIRST
    // decoded frame (a few hundred KB — not the full ~6 MB; the rest streams
    // via the per-plane gating), upload it as a texture, and render one frame.
    // So when the gallery scrolls into view its first paint is instant, with
    // no decode/upload hitch and no blank plane. Runs during the loading screen.
    bootWarmups.push(() => new Promise((resolve) => {
      const renderOnce = () => { try { resize(); renderer.render(scene, camera); } catch (e) {} };
      let pending = videoEls.length;
      if (!pending) { renderOnce(); resolve(); return; }
      let settled = false;
      const finishWarm = () => { if (settled) return; settled = true; renderOnce(); resolve(); };
      videoEls.forEach((v, i) => {
        const onReady = () => {
          v.removeEventListener('loadeddata', onReady);
          if (videoTextures[i]) videoTextures[i].needsUpdate = true;
          if (--pending <= 0) finishWarm();
        };
        v.addEventListener('loadeddata', onReady);
        try { v.preload = 'auto'; v.load(); } catch (e) { onReady(); }
      });
      setTimeout(finishWarm, 4000);   // never let a stalled clip hold the loader
    }));
    // On GPU context loss: stop the loop (THREE clears the buffer, so no frozen
    // frame). On restore: THREE re-uploads its resources; we just resume.
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }, false);
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      try { resize(); kickRender(); } catch (e) {}
    }, false);

    // (The old theme-aware wall-line MutationObserver is gone: the hall
    // is permanently dark and lineMat is never drawn — see its creation.)

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
      // The skills → gallery transition is driven entirely by the WARP camera scrub
      // via warpBridge.paintGallery(cameraZ): the live gallery pin emerges as the
      // final virtual frame, reaches the front, then expands to full screen — ONE
      // continuous live element, no separate intro ScrollTrigger, no screenshot swap.

      // Camera scroll trigger — owns the project PAN (after the fly-in) and the
      // exit gate's `visible`. The camera target holds at project 0 for the
      // first 200vh (the fly-in zone), then pans through projects over the rest.
      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom bottom',
        invalidateOnRefresh: true,
        onEnter:     () => { visible = true; kickRender(); },
        onEnterBack: () => { visible = true; kickRender(); },
        // Forward exit no longer hard-snaps: the exit gate below holds
        // the page at the section edge until the camera has genuinely
        // settled on the last project, so by the time onLeave fires the
        // parting frame already IS the last project. (A forward snap
        // here would instantly mark the camera "settled" and defeat the
        // gate.) Backward exit still snaps to the first project.
        onLeave:     () => { visible = false; },
        onLeaveBack: () => { snapPaintAt(0); },   // intro driver owns `visible` near the top
        onUpdate: (self) => {
          const total = self.end - self.start;
          const skip  = window.innerHeight * 0.1;     // expand already finished by the pan ST's 'top top' start; just a tiny settle, then pan — no dead hold
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

      // ----- Forward exit gate + recoil bounce -----
      // The gallery may NOT be scrolled out of (forward) until the camera
      // has actually settled on the last project. No matter how hard/fast
      // you scroll, the page is pinned at the section's exit edge while
      // the camera is still mid-pan; once it's centered on the last
      // project the gate opens and you can continue to the next section.
      //
      // The block is done by INTERCEPTING the input (wheel / touch /
      // keyboard) and preventing the scroll from ever crossing the exit
      // edge — rather than letting the page lurch past and snapping it
      // back. While scrollY stays inside the gallery's sticky-pin range
      // the canvas doesn't move vertically at all, so the recoil reads as
      // a PURELY HORIZONTAL camera bounce: the blocked forward input is
      // fed into an outward camera velocity, the last project swings out
      // of frame (like the others did) and springs back to center — the
      // bounce scales with how hard you pushed. Backward exit (toward the
      // first project / previous sections) is unchanged.
      const reduceMotionGate = reduceMotionMQ && reduceMotionMQ.matches;
      let scrollLocked = false;
      let lockY = 0;             // page Y the freeze is pinned to (the exit edge)

      // Absolute page Y where the section releases forward.
      function exitY() {
        const rect = section.getBoundingClientRect();
        const top  = rect.top + (window.scrollY || window.pageYOffset);
        return top + (section.offsetHeight - window.innerHeight);
      }
      // Has the camera caught up to the last project? Used to decide whether
      // an approaching scroll needs gating (a fast scroll that outran the
      // camera has not caught up → must lock).
      function isCaughtUp() {
        return Math.abs(LAST_SCROLL - currentScroll) < SETTLE_EPS;
      }
      // Has the recoil come to rest on the last project (debounced)? Used to
      // decide when the lock may RELEASE — never mid-bounce.
      function restingOnLast() {
        return settleFrames >= SETTLE_HOLD;
      }
      // FREEZE the page at the exit edge so the only motion possible is the
      // horizontal camera recoil. overflow:hidden disables scrolling; the
      // scrollbar width is compensated with padding so the layout doesn't
      // shift. overflow:hidden alone is NOT enough — a fling already in
      // flight on the compositor can leak a few frames of scroll past it —
      // so `clampLock()` (called every frame and on every scroll event)
      // hard-pins the position back to the edge until the fling dies.
      function lockAt(ex) {
        lockY = ex;
        if (scrollLocked) return;
        window.scrollTo({ top: ex, behavior: 'instant' });   // align exactly on the edge
        const sw = window.innerWidth - document.documentElement.clientWidth;
        document.documentElement.style.overflow = 'hidden';
        if (sw > 0) document.documentElement.style.paddingRight = sw + 'px';
        scrollLocked = true;
      }
      function clampLock() {
        if (scrollLocked && Math.abs((window.scrollY || window.pageYOffset) - lockY) > 0.5) {
          window.scrollTo({ top: lockY, behavior: 'instant' });
        }
      }
      clampLockFn = clampLock;   // let the render loop pin the page every frame while frozen
      function unlock() {
        if (!scrollLocked) return;
        document.documentElement.style.overflow = '';
        document.documentElement.style.paddingRight = '';
        scrollLocked = false;
      }
      // Engage the hold: pin the camera target to the last project, switch
      // the render loop to the recoil spring, and inject `kickPx` of blocked
      // forward input as outward (horizontal) camera velocity. `targetScroll`
      // is driven here because at exactly progress 1.0 ScrollTrigger fires
      // onLeave (not onUpdate), and `holding` keeps the render loop alive
      // independent of ScrollTrigger's `visible`.
      function engageHold(kickPx) {
        holding = true;
        gateOpen = false;
        targetScroll = LAST_SCROLL;
        if (!reduceMotionGate && kickPx > 0) {
          const kick = Math.min(kickPx * REC_K, REC_MAX);
          if (kick > camVel) { camVel = kick; settleFrames = 0; }  // fresh kick → not rested
        }
        kickRender();
      }
      function releaseHold() { holding = false; gateOpen = true; unlock(); }
      // Normalize a wheel event's deltaY to pixels (it may be in lines or
      // pages depending on the device/OS).
      function wheelPx(e) {
        if (e.deltaMode === 1) return e.deltaY * 16;                 // lines → px
        if (e.deltaMode === 2) return e.deltaY * window.innerHeight; // pages → px
        return e.deltaY;
      }

      window.addEventListener('wheel', (e) => {
        if (scrollLocked) {
          if (e.deltaY < 0) { releaseHold(); return; }         // wants to go back → unfreeze, let it scroll up
          if (restingOnLast()) { releaseHold(); return; }      // rested on last project → unfreeze, let it scroll out
          e.preventDefault();
          engageHold(wheelPx(e));                               // still recoiling → feed the bounce
          return;
        }
        if (e.deltaY <= 0) return;                             // forward only
        const y  = window.scrollY || window.pageYOffset;
        const ex = exitY();
        if (y + wheelPx(e) >= ex && !isCaughtUp()) {
          // This tick would reach/cross the exit while the camera is still
          // catching up: freeze at the edge before the browser can scroll
          // past it.
          e.preventDefault();
          engageHold(Math.max(0, y + wheelPx(e) - ex));
          lockAt(ex);
        }
      }, { passive: false });

      // Touch: finger drag up = forward. Mirror the wheel logic.
      let touchY = 0;
      window.addEventListener('touchstart', (e) => {
        if (e.touches.length) touchY = e.touches[0].clientY;
      }, { passive: true });
      window.addEventListener('touchmove', (e) => {
        if (!e.touches.length) return;
        const cy = e.touches[0].clientY;
        const dy = (touchY - cy) * 1.5;       // up = forward; scale up a touch
        touchY = cy;
        if (scrollLocked) {
          if (dy < 0) { releaseHold(); return; }
          if (restingOnLast()) { releaseHold(); return; }
          e.preventDefault();
          engageHold(dy);
          return;
        }
        if (dy <= 0) return;
        const y  = window.scrollY || window.pageYOffset;
        const ex = exitY();
        if (y + dy >= ex && !isCaughtUp()) {
          e.preventDefault();
          engageHold(Math.max(0, y + dy - ex));
          lockAt(ex);
        }
      }, { passive: false });

      // Keyboard: while frozen, a back/up key unfreezes; a forward key only
      // unfreezes once the camera has settled (so PageDown/Space/End can't
      // skip the last project).
      window.addEventListener('keydown', (e) => {
        if (!scrollLocked) return;
        const k = e.key;
        if (k === 'ArrowUp' || k === 'PageUp' || k === 'Home') { releaseHold(); return; }
        if (restingOnLast() &&
            (k === 'ArrowDown' || k === 'PageDown' || k === 'End' || k === ' ' || k === 'Spacebar')) {
          releaseHold();
        }
      }, { passive: true });

      // Catches anything that scrolls the page toward the exit without firing
      // a cancelable wheel/touch (scrollbar drag, programmatic, and — crucial
      // on real hardware — residual compositor momentum that leaks past the
      // overflow:hidden freeze). While frozen we HARD-PIN back to the edge
      // (instead of ignoring it), so a fling can never carry the page away.
      window.addEventListener('scroll', () => {
        if (scrollLocked) { clampLock(); return; }
        const y  = window.scrollY || window.pageYOffset;
        const ex = exitY();
        if (y >= ex - 1 && !isCaughtUp()) { engageHold(0); lockAt(ex); }
        else if (y < ex) holding = false;
      }, { passive: true });
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
      // When the cursor leaves mid-scramble we let the animation run to
      // completion (owner request); this flag remembers to retract the
      // hover chrome once it finishes rather than cutting it off instantly.
      let pendingUnhover = false;
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
            // Cursor already left while it was running → now that it's
            // finished, retract the underline/glow.
            if (pendingUnhover) {
              host.classList.remove('is-hovered');
              pendingUnhover = false;
            }
          }
        }, INTERVAL_MS);
      }

      // Force the whole hover state off: retract underline/glow and
      // stop any in-flight scramble (chars resolve to their final text).
      // Used on mouseleave AND called externally when the gallery
      // switches projects, so a new title never inherits the old hover.
      let hoverLockUntil = 0;
      host.resetScramble = function (lock) {
        host.classList.remove('is-hovered');
        pendingUnhover = false;
        if (timer) { clearInterval(timer); timer = null; }
        for (let i = 0; i < text.length; i++) {
          charEls[i].textContent = text[i];
          charEls[i].classList.remove('is-scrambling');
        }
        // When a project switch triggers the reset, the active title
        // changes under a stationary cursor and the browser re-fires
        // mouseenter on the new title (element-under-pointer changed) —
        // which would re-light it the instant after this reset. Lock
        // out hover briefly so that synthetic re-entry is ignored; a
        // genuine hover a moment later still works.
        if (lock) hoverLockUntil = performance.now() + 400;
      };

      // Play the scramble on its own (no hover chrome) — the gallery
      // calls this to auto-run the title animation on a project switch.
      host.runScramble = scramble;

      host.addEventListener('mouseenter', function () {
        if (performance.now() < hoverLockUntil) return;
        pendingUnhover = false;          // re-entered → keep the chrome lit
        host.classList.add('is-hovered');
        scramble();
      });
      // Leaving mid-animation must NOT interrupt it: if a scramble is in
      // flight, let it run to the end (the completion handler retracts the
      // chrome). Only when nothing is running do we retract immediately.
      host.addEventListener('mouseleave', function () {
        if (timer) pendingUnhover = true;
        else host.classList.remove('is-hovered');
      });
      host.addEventListener('focus',      scramble);
      host.addEventListener('blur',       function () { host.classList.remove('is-hovered'); });
    });

    // Lock each char to its natural width (batched: clear → read → write to
    // avoid layout thrash). Re-run after fonts load and on resize, since the
    // title font-size is a vw-based clamp.
    const lockWidths = () => {
      if (!allChars.length) return;
      // Measure at the NATURAL (untransformed) size. The gallery titles live
      // inside .hall__pin, which is CSS-scaled down (to a small floating frame)
      // during the warp→gallery intro. getBoundingClientRect() reports the scaled
      // width, so without neutralising that transform the chars would lock to
      // tiny widths and overlap once the pin expands to full screen. Clearing the
      // pin transform for the synchronous read (then restoring it) avoids that —
      // and is invisible (no paint happens between the sync style writes).
      const pin = document.querySelector('.hall__pin');
      const prevT = pin ? pin.style.transform : null;
      if (pin) pin.style.transform = 'none';
      allChars.forEach((el) => { el.style.width = ''; });
      const widths = allChars.map((el) => el.getBoundingClientRect().width);
      allChars.forEach((el, i) => {
        if (widths[i] > 0) {
          el.style.width = widths[i] + 'px';
          el.style.textAlign = 'center';
        }
      });
      if (pin && prevT !== null) pin.style.transform = prevT;
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
  // Build the "good part" headline: inject a reveal block into every
  // word and assemble a paused GSAP timeline that wipes each word in
  // bottom-to-up (block scales up from the bottom edge, the word inks
  // in mid-sweep, then the block continues up and off the top). Played
  // / reversed by setGoodPart() as the cinema view comes and goes.
  function initGoodPart() {
    if (!goodPart) return;
    const words = Array.from(goodPart.querySelectorAll('.goodpart__word'));
    if (!words.length) return;
    const texts = words.map(function (w) { return w.querySelector('.goodpart__text'); });
    const blocks = words.map(function (w) {
      const b = document.createElement('span');
      b.className = 'goodpart__block';
      w.appendChild(b);
      return b;
    });

    const reduce = reduceMotionMQ && reduceMotionMQ.matches;
    if (reduce) {
      // Reduced motion: no wipe. The words just appear / vanish with the
      // cinema state (setGoodPart toggles goodPart.style.opacity instead).
      gsap.set(texts, { opacity: 1 });
      gsap.set(blocks, { display: 'none' });
      goodPart.style.opacity = '0';
      return;
    }

    gsap.set(texts, { opacity: 0 });
    gsap.set(blocks, { scaleY: 0, transformOrigin: 'center bottom' });

    const DUR = 0.6, STAG = 0.085;
    gpTL = gsap.timeline({ paused: true, defaults: { ease: 'expo.inOut' } });
    // A — each block scales UP from its bottom edge, staggered per word.
    gpTL.to(blocks, {
      scaleY: 1, duration: DUR, stagger: STAG, transformOrigin: 'center bottom'
    });
    // B — ink each word in halfway through its own block sweep.
    gpTL.set(texts, { opacity: 1, stagger: STAG }, '<' + (DUR / 2));
    // C — the block keeps moving UP, scaling to 0 off the top edge,
    //     uncovering the word it just revealed.
    gpTL.to(blocks, {
      scaleY: 0, duration: DUR, stagger: STAG, transformOrigin: 'center top'
    }, '<' + (DUR * 0.4));
  }

  // Toggle the headline. Plays the word-wipe forward when entering the
  // cinema view and reverses it (same animation, mirrored) when leaving.
  function setGoodPart(on) {
    if (gpShown === on) return;
    gpShown = on;
    if (gpTL) {
      if (on) gpTL.play(); else gpTL.reverse();
    } else if (goodPart) {
      goodPart.style.opacity = on ? '1' : '0';
    }
  }

  function initHeroSign() {
    const el = document.querySelector('.hero-sign');
    if (!el) return;
    const baseEl = document.getElementById('heroSignBase') || el;

    const wlEl = document.querySelector('.hero__welcome--left');
    const wrEl = document.querySelector('.hero__welcome--right');
    const ease = (t) => 1 - Math.pow(1 - t, 3);   // easeOutCubic
    // Right-edge clip wipe at reveal fraction `f` (0 = hidden, 1 = open).
    // Top/bottom/left pushed WAY out negative (-90% / -90% / -8%) so the wipe
    // can never trim a tall ascender, a long signature descender, or a leading
    // flourish — only the animated RIGHT edge does any hiding.
    const clipAt = (f) => 'inset(-90% ' + (100 - f * 105).toFixed(2) + '% -90% -8%)';
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
      // Safety net: rAF is throttled while the tab is backgrounded / not
      // focused, which can freeze the wipe partway and leave the line visibly
      // "cut off". Force the fully-open clip once the animation's nominal time
      // has elapsed, so both lines always end up completely revealed.
      setTimeout(() => {
        wlEl.style.clipPath = CLIP_OPEN;
        wrEl.style.clipPath = CLIP_OPEN;
      }, DUR + 500);
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

      // ----- Liquid-glass orb (raw-WebGL port of "Liquid Glass Pro Max
      // Plus", the VFX-JS pen). A raymarched refractive sphere with a
      // cluster of floating bubbles (smin-melded), per-wavelength
      // chromatic dispersion, fresnel rim + three specular glints, over
      // the shader's own twinkling starfield. Self-contained (no CDN),
      // DPR 1, and it only spins up while the name is hovered — zero cost
      // otherwise, matching the starfield's own hover gate. Returns null
      // if WebGL is unavailable, in which case the 2D starfield stands in.
      function initLensGlass(cv) {
        let gl = null;
        try {
          gl = cv.getContext('webgl', {
            alpha: true, depth: false, stencil: false, antialias: true,
            premultipliedAlpha: false, powerPreference: 'low-power',
          });
        } catch (e) { /* fall through */ }
        if (!gl) return null;
        // Hover-only effect: on GPU context loss just stop the loop (no frozen
        // frame — it's transparent when idle). `graf` is closed over below.
        cv.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          if (graf) { cancelAnimationFrame(graf); graf = 0; }
        }, false);

        const VERT =
          'attribute vec2 position; varying vec2 vUv;' +
          'void main(){ vUv = position*0.5+0.5; gl_Position = vec4(position,0.0,1.0); }';

        const FRAG = [
          'precision highp float;',
          'varying vec2 vUv;',
          'uniform float iTime;',
          'uniform vec2  iResolution;',
          'uniform vec2  uMouse;',
          'uniform float uShape;',
          'uniform float uClickTime;',
          'uniform float uBubbles[24];',   // N_BUBBLES(6) * 4 = 24
          'uniform sampler2D uText;',       // "Software Engineer" glyph texture
          'uniform vec2  uLensCenter;',     // blob centre in the name-local px frame
          'uniform float uLensSize;',       // canvas size in px
          'uniform vec2  uNameBox;',        // "Aditya Verma" layout box (offsetW,H) px
          'uniform float uTextVH;',         // text band height, fraction of box H
          'uniform float uTextVOff;',       // text band centre, fraction of box H
          'uniform float uHasText;',        // 1 once the texture is uploaded
          'const float SPHERE_R = 0.30;',  // orb radius (leaves a transparent margin)
          // View zoom-out: the ray fan is widened so the orb only fills 1/ZOOM
          // of the buffer, leaving headroom for the entrance bounce to swell
          // WITHOUT reaching the buffer edge. The canvas px size is scaled up
          // by the same factor (see lensSize), so on-screen size is unchanged.
          'const float ZOOM = 1.6;',
          'const float DISP = 0.026;',     // refraction strength — less lensing/zoom through the glass
          'const int   DISP_STEPS = 8;',
          'const float SCATTER = 0.022;',
          'const int   N_BUBBLES = 6;',
          'const float BUBBLE_SMOOTH = 0.06;',
          'const vec3  ABSORB = vec3(2.0, 1.2, 1.0) * 3.0;',
          'float smin(float a, float b, float k){',
          '  float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);',
          '  return mix(b,a,h) - k*h*(1.0-h);',
          '}',
          'vec2 hash22(vec2 p){',
          '  vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));',
          '  p3 += dot(p3, p3.yzx+33.33);',
          '  return fract((p3.xx+p3.yz)*p3.zy)*2.0-1.0;',
          '}',
          'mat2 rot(float t){ float c=cos(t), s=sin(t); return mat2(c,-s,s,c); }',
          'float sdSphere(vec3 p, float r){ return length(p)-r; }',
          'float sdBox(vec3 p, vec3 b, float r){',
          '  vec3 q=abs(p)-b+r;',
          '  return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-r;',
          '}',
          'float sdRing(vec3 p, vec2 r){',
          '  float s=length(p.xy)-r.x; return length(vec2(s,p.z))-r.y;',
          '}',
          // Signed distance to the melded orb+bubbles, with a click-driven
          // squash-bounce (uClickTime) and a slow tumble baked in.
          'float map(vec3 p, vec3 c){',
          '  vec3 q = p - c;',
          // Entrance/click squash-bounce — the big springy overshoot (×5,
          // peaking near 1.6× size). The buffer ZOOM headroom above keeps
          // this from clipping while it swells.
          '  float tt = uClickTime*5.0;',
          '  float bounce = exp(-tt)*sin(tt)*5.0 + (1.0-exp(-tt));',
          '  float s = bounce*0.5+0.5;',
          '  q /= s;',
          '  q.xz *= rot(exp(-uClickTime*3.0)*8.0);',
          '  vec3 sp = q;',
          '  sp.y += sin(sp.z*29.0 + iTime*6.5)*0.01;',
          '  sp.z += sin(sp.x*23.0 + sp.y*11.0 + iTime*7.0)*0.01;',
          '  sp.xy *= rot(iTime*1.3);',
          '  sp.xz *= rot(iTime*1.1);',
          '  float d;',
          '  if (uShape < 0.5) { d = sdSphere(sp, SPHERE_R); }',
          '  else if (uShape < 1.5) { d = sdBox(sp, vec3(SPHERE_R*0.8), 0.03); }',
          '  else { d = sdRing(sp, vec2(SPHERE_R*1.1, 0.05)); }',
          '  for (int i=0;i<N_BUBBLES;i++){',
          '    vec3 bPos = vec3(uBubbles[i*4], uBubbles[i*4+1], uBubbles[i*4+2]);',
          '    float r = uBubbles[i*4+3];',
          '    d = smin(d, sdSphere(q-bPos, max(r,0.001)), BUBBLE_SMOOTH);',
          '  }',
          '  return d*s;',
          '}',
          'vec3 calcNormal(vec3 p, vec3 c){',
          '  vec2 e = vec2(0.001,0.0);',
          '  return normalize(vec3(',
          '    map(p+e.xyy,c)-map(p-e.xyy,c),',
          '    map(p+e.yxy,c)-map(p-e.yxy,c),',
          '    map(p+e.yyx,c)-map(p-e.yyx,c)));',
          '}',
          'vec3 spectrum(float x){',
          '  return clamp(vec3(1.5-abs(4.0*x-1.0),1.5-abs(4.0*x-2.0),1.5-abs(4.0*x-3.0)),0.0,1.0);',
          '}',
          // What the glass refracts: "Software Engineer" laid over the EXACT
          // footprint of "Aditya Verma". A fragment is mapped from canvas-uv
          // into the signature's local pixel frame (blob centre uLensCenter,
          // canvas uLensSize) then normalised by the name box (uNameBox), so
          // the wordmark is spatially locked to the name — the blob is a lens
          // revealing the text underneath, not a floating caption. The tilt is
          // shared (canvas + name both ride the h1's rotation), so they align.
          'vec3 sampleText(vec2 uv){',
          '  vec3 glass = vec3(0.020,0.020,0.028);',   // dark glass body
          '  if (uHasText < 0.5) return glass;',
          '  vec2 loc = uLensCenter + vec2((uv.x-0.5)*uLensSize, (0.5-uv.y)*uLensSize);',
          '  vec2 nb = loc / uNameBox;',               // 0..1 across the name box
          '  float u = nb.x;',                          // full name width
          '  float v = 0.5 - (nb.y - uTextVOff) / uTextVH;',
          '  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return glass;',
          '  float a = texture2D(uText, vec2(u, v)).a;',
          '  return mix(glass, vec3(0.97,0.95,0.87), a);',
          '}',
          'vec4 getSrc(vec2 uv){ return vec4(sampleText(uv),1.0); }',
          'void main(){',
          '  vec2 uv = vUv;',
          '  float aspect = iResolution.y/iResolution.x;',
          '  vec2 p = (uv-0.5)*vec2(1.0, aspect) * ZOOM;',
          '  vec3 ro = vec3(0.0,0.0,-2.0);',
          '  float focal = 2.0;',
          '  vec3 rd = normalize(vec3(p, focal));',
          '  vec3 c = vec3(uMouse*0.015, 0.0);',   // slight wobble; text stays locked
          '  vec3 firstN=vec3(0.0), lastN=vec3(0.0);',
          '  int hitCount=0;',
          '  float thickness=0.0, tEntry=0.0, t=0.0;',
          '  float minD=1e9;',   // closest the ray ever gets to the surface
          '  bool inside=false;',
          '  for (int i=0;i<40;i++){',
          '    if (t>10.0) break;',
          '    vec3 pos = ro+rd*t;',
          '    float d = map(pos,c);',
          '    if (!inside) minD = min(minD, d);',
          '    float stepd = inside ? -d : d;',
          '    if (stepd < 3e-4){',
          '      vec3 n = calcNormal(pos,c);',
          '      if (hitCount==0) firstN=n;',
          '      lastN=n;',
          '      if (!inside) { tEntry=t; } else { thickness += t-tEntry; }',
          '      hitCount++;',
          '      if (hitCount>=4) { break; }',
          '      inside=!inside;',
          '      t += 0.01;',
          '    } else {',
          '      t += stepd;',
          '    }',
          '  }',
          '  if (hitCount>0){',
          '    vec2 baseDisp = -(firstN.xy+lastN.xy)*0.5*DISP;',
          '    float NdotR = max(dot(firstN,-rd),0.0);',
          '    float scatter = pow(1.0-NdotR,2.0)*SCATTER;',
          '    vec3 acc=vec3(0.0), wsum=vec3(0.0);',
          '    for (int i=0;i<DISP_STEPS;i++){',
          '      float wl = float(i)/float(DISP_STEPS-1);',
          '      float k = wl*(1.3+float(hitCount)*0.2);',
          '      vec2 h = hash22(uv*1000.0+float(i)*7.13+iTime)*scatter;',
          '      vec3 w = spectrum(wl);',
          '      acc += getSrc(uv+baseDisp*k+h).rgb*w;',
          '      wsum += w;',
          '    }',
          '    vec3 col = acc/wsum*0.99;',
          '    col -= float(hitCount)*0.05;',
          '    col += 0.1;',
          '    float fres = pow(1.0-NdotR,5.0);',
          '    col *= 1.0+fres;',
          '    float f2 = 1.0-pow(NdotR,3.0);',
          '    col *= mix(vec3(1.0), exp(-ABSORB*thickness), f2);',
          '    col *= 1.0+f2;',
          '    vec3 ld = normalize(vec3(0.5,0.9,-0.3));',
          '    float spec = pow(max(dot(reflect(-ld,firstN),-rd),0.0),200.0);',
          '    col += spec*30.0;',
          '    ld = normalize(vec3(-0.9,0.4,-0.3));',
          '    spec = pow(max(dot(reflect(-ld,firstN),-rd),0.0),300.0);',
          '    col += spec*3.0;',
          '    ld = normalize(vec3(-0.1,-0.9,-0.1));',
          '    spec = pow(max(dot(reflect(-ld,firstN),-rd),0.0),30.0);',
          '    col += spec*0.5;',
          '    col = min(col,1.0);',
          '    col = 1.0 - abs(col+fres*0.5-1.0);',
          '    gl_FragColor = vec4(col,1.0);',
          '  } else {',
          // Outside the blob: fully transparent, so there is no circle — just
          // the free-floating glass shape. A thin feather off the closest
          // approach (minD) anti-aliases the organic silhouette against the
          // page (the raymarch edge is otherwise hard at DPR 1).
          '    float edge = 1.0 - smoothstep(0.0, 0.006, minD);',
          '    gl_FragColor = vec4(0.0, 0.0, 0.0, edge * 0.85);',
          '  }',
          '}',
        ].join('\n');

        function compile(type, src) {
          const sh = gl.createShader(type);
          gl.shaderSource(sh, src);
          gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
          return sh;
        }
        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
        gl.useProgram(prog);

        const gbuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, gbuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const gloc = gl.getAttribLocation(prog, 'position');
        gl.enableVertexAttribArray(gloc);
        gl.vertexAttribPointer(gloc, 2, gl.FLOAT, false, 0, 0);
        // Straight-alpha blend — outside the blob the shader outputs alpha 0,
        // so the page shows through (no circle) and the silhouette feathers.
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        const uTime  = gl.getUniformLocation(prog, 'iTime');
        const uRes   = gl.getUniformLocation(prog, 'iResolution');
        const uMouse = gl.getUniformLocation(prog, 'uMouse');
        const uShape = gl.getUniformLocation(prog, 'uShape');
        const uClick = gl.getUniformLocation(prog, 'uClickTime');
        const uBub   = gl.getUniformLocation(prog, 'uBubbles');
        const uText   = gl.getUniformLocation(prog, 'uText');
        const uLensC  = gl.getUniformLocation(prog, 'uLensCenter');
        const uLensSz = gl.getUniformLocation(prog, 'uLensSize');
        const uNameB  = gl.getUniformLocation(prog, 'uNameBox');
        const uTextVH = gl.getUniformLocation(prog, 'uTextVH');
        const uTextVO = gl.getUniformLocation(prog, 'uTextVOff');
        const uHasT   = gl.getUniformLocation(prog, 'uHasText');

        // "Software Engineer" glyph texture (uploaded on hover once fonts are
        // ready) plus the geometry that locks it onto the name's footprint.
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.useProgram(prog);
        gl.uniform1i(uText, 0);
        gl.uniform1f(uHasT, 0);
        let hasText = false;
        let lensCX = 0, lensCY = 0;   // blob centre in name-local px

        const N = 6, SPHERE_R = 0.30, B_MIN = 0.06, B_MAX = 0.16, B_SPEED = 0.7;
        const bub = new Float32Array(N * 4);
        const fr = (x) => x - Math.floor(x);
        const rot2d = (x, y, a) => {
          const c = Math.cos(a), s = Math.sin(a);
          return [x * c - y * s, x * s + y * c];
        };
        let shape = 0;
        let size = 0, graf = 0, gt0 = performance.now(), clickT0 = performance.now();
        const gmouse = { x: 0, y: 0, tx: 0, ty: 0 };

        // Orbiting, rising bubbles — the "liquid" inside the glass. Ported
        // from the pen's JS tick, minus the page-mouse displacement (the
        // orb is centred in the circle, not cursor-parented).
        function fillBubbles(time) {
          for (let i = 0; i < N; i++) {
            const life = fr(time * B_SPEED + i / N);
            const orbitR = SPHERE_R * (0.3 + life * 0.8);
            const ang = time * (0.8 + fr(i * 0.618) * 0.7) + i * 1.256;
            let bx = Math.cos(ang) * orbitR, by = 0, bz = Math.sin(ang) * orbitR;
            let r1 = rot2d(bx, by, i * 2.3); bx = r1[0]; by = r1[1];
            let r2 = rot2d(by, bz, i * 1.8); by = r2[0]; bz = r2[1];
            by += life * 0.10;
            bx += Math.sin(time * 2.7 + i * 4.1) * 0.01 * life;
            bz += Math.cos(time * 3.1 + i * 3.7) * 0.01 * life;
            const maxR = B_MIN + (B_MAX - B_MIN) * fr(i * 0.618);
            const j = i * 4;
            bub[j] = bx; bub[j + 1] = by; bub[j + 2] = bz;
            bub[j + 3] = maxR * Math.sin(life * Math.PI);
          }
        }
        function gdraw(now) {
          const time = (now - gt0) / 1000;
          gmouse.x += (gmouse.tx - gmouse.x) * 0.08;
          gmouse.y += (gmouse.ty - gmouse.y) * 0.08;
          fillBubbles(time);
          gl.uniform1f(uTime, time);
          gl.uniform2f(uMouse, gmouse.x, gmouse.y);
          gl.uniform1f(uShape, shape);
          gl.uniform1f(uClick, (now - clickT0) / 1000);
          gl.uniform1fv(uBub, bub);
          gl.uniform2f(uLensC, lensCX, lensCY);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        function gtick(now) {
          graf = 0;
          // perf-lite can arrive later (adaptive FPS probe) — bail so the
          // orb stops; the next hover falls back to the 2D starfield.
          if (document.body.classList.contains('perf-lite')) return;
          gdraw(now);
          graf = requestAnimationFrame(gtick);
        }
        return {
          ok() { return !document.body.classList.contains('perf-lite'); },
          resize(px) {
            size = Math.max(1, Math.round(px));
            if (cv.width !== size || cv.height !== size) { cv.width = size; cv.height = size; }
            gl.useProgram(prog);
            gl.viewport(0, 0, size, size);
            gl.uniform2f(uRes, size, size);
          },
          kick() {
            if (graf || document.body.classList.contains('perf-lite')) return;
            // Reset the clocks so every hover pops the orb in fresh (the
            // squash-bounce plays from uClickTime≈0).
            gt0 = clickT0 = performance.now();
            graf = requestAnimationFrame(gtick);
          },
          stop() { if (graf) { cancelAnimationFrame(graf); graf = 0; } },
          morph() { shape = (shape + 1) % 3; clickT0 = performance.now(); if (!graf) this.kick(); },
          setMouse(nx, ny) { gmouse.tx = nx; gmouse.ty = ny; },
          // Upload the wordmark canvas as the refraction source.
          setText(canvasEl) {
            gl.useProgram(prog);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasEl);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.uniform1f(uHasT, 1);
            hasText = true;
          },
          hasText() { return hasText; },
          // The geometry that pins the wordmark to the name: canvas size, the
          // name's layout box (px), and the text band's vertical placement.
          setName(lensPx, boxW, boxH, vh, voff) {
            gl.useProgram(prog);
            gl.uniform1f(uLensSz, lensPx);
            gl.uniform2f(uNameB, Math.max(1, boxW), Math.max(1, boxH));
            gl.uniform1f(uTextVH, vh);
            gl.uniform1f(uTextVO, voff);
          },
          // Blob centre, in the name's local (un-rotated) px frame.
          setCenter(cx, cy) { lensCX = cx; lensCY = cy; },
        };
      }
      const glassCanvas = document.getElementById('heroSignLensGlass');
      const glass = (glassCanvas && !(reduceMotionMQ && reduceMotionMQ.matches))
        ? initLensGlass(glassCanvas) : null;

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

      // Render "Software Engineer" (in the signature's own cursive) to an
      // offscreen canvas, cream on transparent and TIGHTLY cropped to the
      // glyph bounds, so the shader can stretch it cleanly onto the name's
      // footprint. Built lazily on first hover (fonts ready) and cached.
      let textBuilt = 0;   // the font-px the current texture was built at
      function buildLensTextGlass() {
        if (!glass || !lensText) return;
        const cs = getComputedStyle(lensText);
        const glyph = 200;                  // render size (px); scaled in-shader
        if (Math.abs(glyph - textBuilt) < 2 && glass.hasText()) return;
        const off = document.createElement('canvas');
        const octx = off.getContext('2d');
        const fontStr = (cs.fontStyle || 'normal') + ' ' + (cs.fontWeight || '400') +
                        ' ' + glyph + 'px ' + (cs.fontFamily || 'cursive');
        octx.font = fontStr;
        const txt = (lensText.textContent || 'Software Engineer').trim();
        const m = octx.measureText(txt);
        const asc = m.actualBoundingBoxAscent  || glyph * 0.72;
        const desc = m.actualBoundingBoxDescent || glyph * 0.28;
        const padX = Math.round(glyph * 0.12);
        const w = Math.max(2, Math.ceil(m.width) + padX * 2);
        const h = Math.max(2, Math.ceil(asc + desc));
        off.width = w; off.height = h;
        octx.clearRect(0, 0, w, h);
        octx.font = fontStr;                 // reset after resize
        octx.textAlign = 'left';
        octx.textBaseline = 'alphabetic';
        octx.fillStyle = '#F4F0E7';
        octx.fillText(txt, padX, asc);       // baseline at the ascent
        glass.setText(off);
        textBuilt = glyph;
      }

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
        // Glass mode: the wordmark is world-locked to the name, so just feed
        // the blob's centre (name-local px) — the shader maps each fragment
        // onto "Aditya Verma"'s footprint. Fallback: scroll the crisp DOM text.
        if (glass && lens.classList.contains('hero-sign__lens--glass')) {
          glass.setCenter(cur.x, cur.y);
        } else if (lensText) {
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
        // Lens box size = the on-screen ×1.7 footprint times the shader's
        // ZOOM (1.6) headroom, so the blob renders at 1/ZOOM of a buffer this
        // big. That leaves ample transparent margin for the ×5 entrance
        // bounce to swell into without ever touching the buffer edge, while
        // the visible orb + text overlap stay exactly the same size.
        const fs = parseFloat(getComputedStyle(el).fontSize) || 280;
        // Prefer the WebGL liquid-glass orb; fall back to the 2D starfield
        // when WebGL is unavailable or the device dropped to perf-lite.
        if (glass && glass.ok()) {
          const lensSize = Math.round(fs * 1.7 * 1.6);
          lens.style.width = lens.style.height = lensSize + 'px';
          lens.classList.add('hero-sign__lens--glass');
          buildLensTextGlass();
          // Lock the wordmark to the name's box. TEXT_VH/OFF place the band
          // vertically over "Aditya Verma" (tuned to the cursive's body).
          glass.setName(lensSize, el.offsetWidth, el.offsetHeight, 0.92, 0.50);
          glass.setCenter(cur.x, cur.y);
          glass.resize(lensSize);
          glass.kick();
        } else {
          const lensSize = Math.round(fs * 1.25);
          lens.style.width = lens.style.height = lensSize + 'px';
          lens.classList.remove('hero-sign__lens--glass');
          sizeStars();
          if (sctx && !starsRaf) starsRaf = requestAnimationFrame(drawStars);
        }
        if (!lraf) lraf = requestAnimationFrame(lensTick);
      });
      el.addEventListener('mousemove', (e) => {
        const p = toLocal(e.clientX, e.clientY);
        target.x = p.x;
        target.y = p.y;
        // Gentle viewport-normalized wobble for the orb (refraction + rim
        // shift), matching the warp portal's cursor mapping.
        if (glass) glass.setMouse(
          (e.clientX / window.innerWidth - 0.5) * 2,
          -(e.clientY / window.innerHeight - 0.5) * 2);
        if (!lraf) lraf = requestAnimationFrame(lensTick);
      });
      // Clicking the name morphs the orb: sphere → box → ring (the pen's
      // click-cycle), each with a fresh squash-bounce.
      el.addEventListener('pointerdown', () => { if (glass && glass.ok()) glass.morph(); });
      el.addEventListener('mouseleave', () => {
        hovering = false;
        lens.style.width = lens.style.height = '0px';
        if (starsRaf) { cancelAnimationFrame(starsRaf); starsRaf = 0; }
        if (glass) glass.stop();
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
     Hero ripple grid — animated infinite grid behind the whole
     character scene. Vanilla-WebGL port of the ogl "RippleGrid"
     shader, recolored ink-on-cream to sit with the topo contours.
     Perf contract matches the rest of the hero:
       - DPR capped at 1 (the effect is a soft glow — low res is
         invisible, and it bounds the fragment cost at 4K).
       - The rAF loop runs ONLY while the hero pin is on screen
         (own IntersectionObserver, same pattern as the reel gate).
       - Reduced-motion renders ONE static frame, no loop.
       - perf-lite (at init or when the FPS probe adds it later)
         freezes on the current frame — grid stays visible, cost
         drops to zero, mirroring the frozen CSS ambients.
     ------------------------------------------------------- */
  // Shared factory for the 3D-room wireframe layer: `canvas` is drawn at
  // `host`'s size (host also feeds the mouse ripple), the rAF loop is
  // IO-gated on `observeEl`. Instantiated for the hero pin AND the
  // contact section — one shader, two rooms.
  function initRoomGrid(canvas, host, observeEl) {
    if (!canvas || !host || !observeEl) return;
    let gl = null;
    try {
      gl = canvas.getContext('webgl', {
        // PREMULTIPLIED alpha (the spec-defined compositing path). The old
        // premultipliedAlpha:false + straight-colour + SRC_ALPHA blend wrote a
        // buffer whose colour was already premultiplied AND whose alpha channel
        // got squared, which the browser then re-composited as non-premultiplied
        // — a triple-ambiguity Chrome/Firefox/Safari each resolved differently,
        // so the grid looked darker on some browsers/GPUs. Premultiplied alpha +
        // ONE,ONE_MINUS_SRC_ALPHA + a premultiplied fragment is well-defined and
        // renders identically everywhere.
        alpha: true, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: true, powerPreference: 'low-power',
      });
    } catch (e) { /* fall through */ }
    if (!gl) { canvas.remove(); return; }

    const VERT = [
      'attribute vec2 position;',
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = position * 0.5 + 0.5;',
      '  gl_Position = vec4(position, 0.0, 1.0);',
      '}',
    ].join('\n');

    // The RippleGrid check lattice is REPLACED by a one-point-perspective
    // 3D ROOM wireframe (per reference): back-wall rectangle carrying a
    // sleek check lattice, corner seams to the viewport corners, ~2
    // receding depth rungs per wall and ~4 converging rails per surface.
    // The old lattice's ripple + mouse-wave "liquid" distortion warps
    // every line identically. EVERY line is drawn by ONE shared
    // screen-space hairline function (fwidth-based, ~1.5px, crisp AA at
    // any DPR / any parameter space) so the whole drawing reads as the
    // same sharp pen. Falls back to a tight exp profile on the rare GPU
    // without OES_standard_derivatives.
    const hasDeriv = !!gl.getExtension('OES_standard_derivatives');
    const FRAG = [
      hasDeriv ? '#extension GL_OES_standard_derivatives : enable' : '',
      'precision highp float;',
      'uniform float iTime;',
      'uniform vec2 iResolution;',
      'uniform vec2 mousePosition;',
      'uniform float mouseInfluence;',
      'uniform float uRot;',
      'varying vec2 vUv;',
      'const float PI = 3.141592;',
      // Warm sepia-gray rather than pure ink — matches the faint topo
      // contour color so the room reads as the same paper texture.
      'const vec3  GRID_COLOR = vec3(0.20, 0.18, 0.14);',
      'const float RIPPLE = 0.05;',
      'const float OPACITY = 0.15;',
      'const float MOUSE_R = 1.2;',
      // The room is now the INTERIOR of a box, drawn by ray-casting from
      // the camera at its centre. BOX = half extents (world units). Y and
      // Z are EQUAL so a 90° pitch maps the floor exactly onto the back
      // wall (seamless loop); X (room width) is wider to keep the familiar
      // wide-room proportion. FOCAL = image-plane distance = how much of
      // the side walls is seen (smaller -> deeper room).
      'const vec3  BOX = vec3(1.2857, 1.0, 1.0);',
      'const float FOCAL = 0.56;',
      // Grid divisions per HALF-face: X splits into 2*NX cells, Y & Z into
      // 2*NY. Every face carries this same lattice, and because BOX.y==BOX.z
      // with a shared NY the columns/rows run unbroken across the rotation.
      // NX 5 / NY 3 = one extra evenly-spaced line per side vs the old 4 / 2
      // (10 columns, 6 rows), still integer-divided so lines land on the
      // borders and mirror perfectly about both centre axes.
      'const float NX = 5.0;',
      'const float NY = 3.0;',
      // Extra perspective ring hugging the back wall: one line at this
      // normalized depth (1.0 = right on the wall) drawn on the Y and Z
      // borders both, so it reads as a rectangle just inside the back wall
      // on the floor, ceiling and both side walls — and, being Y/Z-symmetric,
      // it stays put through the 90° floor->back-wall rotation.
      'const float RING_T = 0.86;',
      // Uniform ink: every line family draws at amplitude 1.0 (same
      // darkness); ROOM_STR alone sets the overall presence. NOTE the
      // hero reel frames carry a BAKED-IN soft white ambient glow (part
      // of the character renders, drawn on the canvas ABOVE this layer)
      // that eats roughly half the lines' contrast across most of the
      // frame — judge this value against the WASHED on-page result, not
      // the raw canvas. Retuned to 1.2 when the compositing moved to the
      // correct premultiplied path (which no longer attenuates the ink), so
      // the on-page result matches the original light look — now identically
      // across browsers.
      'const float ROOM_STR = 0.6;',
      // ---- Room shading (soft shadows so the wireframe reads as a lit box) ----
      // All shading below is a pure function of the box-space hit and is
      // SYMMETRIC under the 90 deg X-rotation (BOX.y==BOX.z), so it rotates
      // WITH the geometry and never breaks the seamless floor->back-wall loop.
      // "depth" = distance from the room centre (== the camera/viewer): it is
      // smallest at the near face-centres (~1.0) and largest out in the far
      // corners (~1.91), so the corners pool into shade while the back-wall
      // centre stays open and bright — exactly how a real room reads.
      'const float DEPTH_A = 1.02;',   // length(p) that still reads as "near"
      'const float DEPTH_B = 1.86;',   // length(p) of a deep far corner
      'const float AO_WIDTH = 2.3;',   // how far the contact shadow reaches in from an edge
      'const float AO_NEAR = 0.15;',   // edge/contact shadow on the near walls (ink units)
      'const float AO_FAR  = 0.55;',   // extra edge shadow deep in the room (far corners)
      'const float FILL    = 0.16;',   // faint deep-volume wash away from the edges
      // One pen for everything: a constant-screen-width stroke around
      // d = 0, self-normalizing via fwidth in whatever space d lives in.
      // Very thin, near-hairline core + short feather for a sleek, subtle
      // stroke; the supersampled backing (see resize) keeps it smooth.
      hasDeriv
        ? 'float lineAA(float d) { float w = fwidth(d) + 1e-6; return 1.0 - smoothstep(w * 0.85, w * 2.1, d); }'
        : 'float lineAA(float d) { return exp(-85.0 * d); }',
      'void main() {',
      '  vec2 uv = vUv * 2.0 - 1.0;',
      '  uv.x *= iResolution.x / iResolution.y;',
      '  float dist = length(uv);',
      '  float func = sin(PI * (iTime - dist));',
      '  vec2 rippleUv = uv + uv * func * RIPPLE;',
      '  if (mouseInfluence > 0.0) {',
      '    vec2 mouseUv = (mousePosition * 2.0 - 1.0);',
      '    mouseUv.x *= iResolution.x / iResolution.y;',
      '    float mouseDist = length(uv - mouseUv);',
      '    float influence = mouseInfluence * exp(-mouseDist * mouseDist / (MOUSE_R * MOUSE_R));',
      '    float mouseWave = sin(PI * (iTime * 2.0 - mouseDist * 3.0)) * influence;',
      '    rippleUv += normalize(uv - mouseUv) * mouseWave * RIPPLE * 0.3;',
      '  }',
      // Screen-proportional image plane (aspect divided back out so the
      // room keeps its on-screen proportions at any width), carrying the
      // ripple so the whole room still wobbles with the same liquid.
      '  vec2 rp = rippleUv;',
      '  rp.x /= (iResolution.x / iResolution.y);',
      // Camera sits at the box centre looking down +Z; every pixel is a
      // ray through the image plane at distance FOCAL.
      '  vec3 dir = vec3(rp.x, rp.y, FOCAL);',
      // Pitch the ray about X by uRot. As uRot grows the forward ray tilts
      // from +Z toward -Y, so the floor swings UP into the centre and
      // becomes the next back wall — one clean 90° step per section.
      '  float ca = cos(uRot);',
      '  float sa = sin(uRot);',
      '  vec3 rd = vec3(dir.x, dir.y * ca - dir.z * sa, dir.y * sa + dir.z * ca);',
      // First interior face the ray exits (camera at origin): smallest t
      // to the ±BOX planes. p is the hit point, one |coord| == its extent.
      '  vec3 ad = abs(rd) + 1e-6;',
      '  vec3 tF = BOX / ad;',
      '  float t = min(tF.x, min(tF.y, tF.z));',
      '  vec3 p = rd * t;',
      // Per-face cell coordinates: X at NX per half, Y & Z at NY per half.
      '  vec3 cell = vec3(p.x / BOX.x * NX, p.y / BOX.y * NY, p.z / BOX.z * NY);',
      // Which face? largest normalized coord == 1. (ties = cube edges,
      // measure-zero and covered by the edge line below.)
      '  vec3 e = abs(p) / BOX;',
      '  float onX = step(e.y, e.x) * step(e.z, e.x);',
      '  float onY = step(e.x, e.y) * step(e.z, e.y);',
      '  float onZ = 1.0 - onX - onY;',
      // the two in-plane cell coords for the hit face (order is irrelevant
      // — both line families are drawn):
      '  float g1 = onX * cell.y + onY * cell.x + onZ * cell.x;',
      '  float g2 = onX * cell.z + onY * cell.z + onZ * cell.y;',
      '  float room = 0.0;',
      '  room = max(room, lineAA(abs(sin(PI * g1))));',
      '  room = max(room, lineAA(abs(sin(PI * g2))));',
      // Cube silhouette edges = back-wall outline + corner seams: where the
      // SECOND-largest normalized coord also reaches 1 (two faces meet).
      '  float m1 = max(e.x, max(e.y, e.z));',
      '  float m3 = min(e.x, min(e.y, e.z));',
      '  float m2 = e.x + e.y + e.z - m1 - m3;',
      '  room = max(room, lineAA(abs(m2 - 1.0)));',
      // Back-wall-hugging ring: a line at depth RING_T on the Y and Z
      // borders. On a side face (floor/ceiling/left/right) the coordinate
      // running toward the back wall reaches RING_T just inside the wall, so
      // the four segments join into one rectangle close to the back wall.
      '  room = max(room, lineAA(abs(e.y - RING_T)));',
      '  room = max(room, lineAA(abs(e.z - RING_T)));',
      // ---- Soft shading: corner/edge ambient occlusion + depth volume ----
      // depth (0 near face-centres -> 1 in the far corners) via distance from
      // the room centre; loop-safe because length(p) is unchanged by the pitch.
      '  float depth = smoothstep(DEPTH_A, DEPTH_B, length(p));',
      // Contact band hugging every cube edge (the 2nd-largest normalized coord
      // approaches 1 where two faces meet); squared for a soft falloff onto the
      // open middle of each face.
      '  float edge = 1.0 - clamp(abs(m2 - 1.0) * AO_WIDTH, 0.0, 1.0);',
      '  edge *= edge;',
      // Every edge is shadowed a little; edges deep in the room (far corners)
      // much more, plus a faint volume wash that grows with depth so the box
      // keeps its solidity even away from the edges. Same warm sepia ink.
      '  float shade = edge * (AO_NEAR + AO_FAR * depth) + FILL * depth * depth;',
      '  float alpha = clamp((room * ROOM_STR + shade) * OPACITY, 0.0, 1.0);',
      // Premultiplied output: colour carries * alpha, matched by the
      // ONE, ONE_MINUS_SRC_ALPHA blend and premultipliedAlpha:true context.
      '  gl_FragColor = vec4(GRID_COLOR * alpha, alpha);',
      '}',
    ].join('\n');

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    }
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.remove(); return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);

    // Single fullscreen triangle.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const locPos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    // Premultiplied-over: fragment already carries colour*alpha (see FRAG).
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'iTime');
    const uRes = gl.getUniformLocation(prog, 'iResolution');
    const uMouse = gl.getUniformLocation(prog, 'mousePosition');
    const uInf = gl.getUniformLocation(prog, 'mouseInfluence');
    const uRot = gl.getUniformLocation(prog, 'uRot');

    // Scene-driven room rotation: exactly one face (90°) per hero checkpoint
    // scene (target = heroSceneRot, written by the cinema tick). rot eases
    // toward it so the turn is smooth and settles square-on when the reel is
    // parked. The box is seamless (floor -> back wall) so the value climbs
    // past 90°/180°/270° with no visible jump.
    const rot = { cur: 0, target: 0 };

    const reduce = !!(reduceMotionMQ && reduceMotionMQ.matches);
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, inf: 0, tinf: 0 };
    // Shader-clock rate. The stock component runs the ripple at a 2s
    // period — far too busy for this page. 0.22 stretches it to ~9s,
    // the same lazy cadence as the halo pulse.
    const TIME_SCALE = 0.22;
    // (The old lattice's reel-follow scroll offset is gone — the room
    // wireframe is architecture, locked to the screen.)
    let raf = 0;
    let visible = true;
    const t0 = performance.now();

    function draw(tSec) {
      mouse.x += (mouse.tx - mouse.x) * 0.1;
      mouse.y += (mouse.ty - mouse.y) * 0.1;
      mouse.inf += (mouse.tinf - mouse.inf) * 0.05;
      // 90° per hero scene, eased so the turn is smooth and lands flat when
      // the reel parks on a checkpoint. Ease is tight enough (0.25) that the
      // cube settles within the ROT_LEAD window — i.e. slightly BEFORE the reel
      // reaches the stop — rather than trailing it.
      rot.target = heroSceneRot;
      rot.cur += (rot.target - rot.cur) * 0.25;
      gl.uniform1f(uTime, tSec);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uInf, mouse.inf);
      gl.uniform1f(uRot, rot.cur);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function tick(now) {
      raf = 0;
      if (!visible) return;
      draw(((now - t0) / 1000) * TIME_SCALE);
      // perf-lite can arrive later (adaptive FPS probe) — freeze on
      // this frame; the grid stays visible at zero ongoing cost.
      if (document.body.classList.contains('perf-lite')) return;
      raf = requestAnimationFrame(tick);
    }
    function kick() {
      if (!raf && visible && !reduce) raf = requestAnimationFrame(tick);
    }

    function resize() {
      // Supersampled backing: render ~1.35× above device resolution and
      // let the browser downscale — that resample is what smooths the
      // hairlines' edges (GPU derivative AA alone is quantized to 2×2
      // pixel quads and read as "pixelated"). Capped at 2× CSS px; the
      // shader is a few dozen ALU, so the extra pixels stay cheap.
      const scale = Math.min((window.devicePixelRatio || 1) * 1.35, 2.0);
      const w = Math.max(1, Math.round(host.clientWidth * scale));
      const h = Math.max(1, Math.round(host.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      if (reduce) draw(1.0);   // static frame (sin(PI*t) term ≈ 0)
      else kick();
    }
    window.addEventListener('resize', resize);
    resize();

    // Boot warmup: guarantee a sized first paint during the loading screen
    // (the shader already compiled above). Graceful GPU-context-loss handling:
    // the browser clears the drawing buffer on loss (transparent, not a frozen
    // frame), we just stop the now-dead loop so it can't spin/error forever.
    bootWarmups.push(() => { try { resize(); } catch (e) {} });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }, false);

    if (reduce) return;        // static frame drawn; no loop, no mouse

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        // Re-measure on entry: hosts under content-visibility:auto (the
        // contact section) only get their real layout near the viewport.
        if (visible) resize();
        else if (raf) { cancelAnimationFrame(raf); raf = 0; }
      }).observe(observeEl);
    }

    // Mouse ripple — listeners live on the host (the canvas itself is
    // pointer-events: none so the section's hovers keep working).
    host.addEventListener('mousemove', (e) => {
      const r = host.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left) / r.width;
      mouse.ty = 1 - (e.clientY - r.top) / r.height;
    }, { passive: true });
    host.addEventListener('mouseenter', () => { mouse.tinf = 1; }, { passive: true });
    host.addEventListener('mouseleave', () => { mouse.tinf = 0; }, { passive: true });

    kick();
  }

  function initHeroGrid() {
    initRoomGrid(
      document.getElementById('heroGrid'),
      document.querySelector('.hero-stage__pin'),
      document.getElementById('hero')
    );
  }

  // Clean 3D studio room lining the contact section, replicated from the
  // reference render: near-full-frame back wall, straight hairline panel
  // seams (wall verticals ±0.77 continuing onto the floor, a horizontal
  // at +0.27 continuing onto the side walls, ceiling rails at ±0.5), one
  // near-wall depth rung, and layered soft shading (junction AO, corner
  // AO, toward-viewer falloff, frame vignette) as ink-alpha washes over
  // the page cream. STATIC: no clock, no mouse — draws once per
  // (re)size, so its steady-state cost is zero.
  function initContactRoom() {
    const section = document.getElementById('contact');
    const canvas = document.getElementById('contactGrid');
    if (!section || !canvas) return;
    let gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: true, depth: false, stencil: false, antialias: false,
        // PREMULTIPLIED alpha — same cross-browser fix as initRoomGrid: the
        // old premultipliedAlpha:false + straight-colour + SRC_ALPHA blend is
        // undefined-ish compositing that renders darker on some browsers/GPUs
        // (and washed-out here). See [[hero-grid-premultiplied-alpha]].
        premultipliedAlpha: true, powerPreference: 'low-power',
      });
    } catch (e) { /* fall through */ }
    if (!gl) { canvas.remove(); return; }
    const hasDeriv = !!gl.getExtension('OES_standard_derivatives');

    const VERT = [
      'attribute vec2 position;',
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = position * 0.5 + 0.5;',
      '  gl_Position = vec4(position, 0.0, 1.0);',
      '}',
    ].join('\n');

    const FRAG = [
      hasDeriv ? '#extension GL_OES_standard_derivatives : enable' : '',
      'precision highp float;',
      'varying vec2 vUv;',
      'const float PI = 3.141592;',
      'const vec3 INK = vec3(0.20, 0.18, 0.14);',
      // Back-wall half extents + vanishing-point lift. Smaller wall =
      // deeper room: wide ceiling/floor/side bands all around.
      'const vec2 B = vec2(0.70, 0.64);',
      'const float VSHIFT = 0.04;',
      hasDeriv
        ? 'float lineAA(float d) { float w = fwidth(d) + 1e-6; return 1.0 - smoothstep(w * 0.85, w * 2.1, d); }'
        : 'float lineAA(float d) { return exp(-85.0 * d); }',
      'void main() {',
      '  vec2 fUv = vUv * 2.0 - 1.0;',
      '  vec2 rp = fUv;',
      '  rp.y -= VSHIFT;',
      '  vec2 arp = abs(rp);',
      '  float fx = arp.x / B.x;',
      '  float fy = arp.y / B.y;',
      '  float face = max(fx, fy);',
      '  float depth = 1.0 / max(face, 1.0);',
      // ---- straight hairline seams, fully symmetric ----
      '  float L = 0.0;',
      '  L = max(L, lineAA(abs(face - 1.0)));',              // wall junctions
      '  if (face > 1.0) {',
      '    L = max(L, lineAA(abs(fx - fy) / face));',        // corner seams
      '    float rayC = (fx > fy) ? (rp.y / arp.x) * (B.x / B.y)',
      '                           : (rp.x / arp.y) * (B.y / B.x);',
      // rails at -0.5 / 0 / +0.5 on ALL four surfaces — every wall seam
      // continues radially outward so the grid fills the entire screen
      // converging rails every 0.25 (was 3 hard rails at -0.5/0/+0.5) so the
      // floor/ceiling/side bands stay covered right up to the near frame edge
      '    L = max(L, lineAA(abs(sin(PI * rayC * 4.0))));',
      // depth rungs — the viewport-centred canvas (see .contact__room CSS)
      // keeps the near floor from stretching, so a moderate frequency covers
      // down to the bottom without a busy grid
      '    L = max(L, lineAA(abs(sin(PI * (depth * 10.0 + 0.5)))));',
      '  } else {',
      // back-wall panel grid: seams at -0.5 / 0 / +0.5 on BOTH axes cut
      // the wall into 4 equal columns x 4 equal rows
      '    float wx = rp.x / B.x;',
      '    float wy = rp.y / B.y;',
      '    L = max(L, lineAA(min(min(abs(wx - 0.5), abs(wx + 0.5)), abs(wx))));',
      '    L = max(L, lineAA(min(min(abs(wy - 0.5), abs(wy + 0.5)), abs(wy))));',
      '  }',
      // ---- soft room shading (matched to initRoomGrid's shaded-box look) ----
      // Broad, soft contact shadows that pool in the back-wall corners and
      // deepen toward the near frame, so the wireframe reads as a lit room.
      '  float shade = 0.058 * exp(-abs(face - 1.0) * 2.3);',        // junction AO (back-wall perimeter)
      '  if (face > 1.0) {',
      // toward-viewer falloff, normalized over the room's on-screen
      // depth band (depth spans ~1.0 -> ~0.64 at the frame corners)
      '    float nd = clamp((1.0 - depth) / 0.36, 0.0, 1.0);',
      '    shade += 0.035 * nd * nd;',
      '    shade += 0.058 * exp(-(abs(fx - fy) / face) * 2.3);',     // corner AO (side-wall seams)
      '  }',
      '  shade += 0.03 * smoothstep(0.82, 1.42, max(abs(fUv.x), abs(fUv.y)));', // frame vignette
      '  float alpha = L * 0.1 + shade;',
      // Premultiplied output: colour carries * alpha, matched by the
      // ONE, ONE_MINUS_SRC_ALPHA blend and premultipliedAlpha:true context.
      '  float a = clamp(alpha, 0.0, 0.55);',
      '  gl_FragColor = vec4(INK * a, a);',
      '}',
    ].join('\n');

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    }
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.remove(); return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const locPos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    // Premultiplied-over: fragment carries colour*alpha (see FRAG output).
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let lost = false;
    function draw() {
      if (lost) return;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function resize() {
      // Same supersampled backing as the hero room for crisp seams.
      // Sized from the CANVAS box, not the section — the canvas bleeds
      // 28vh above the section (see .contact__room) to fill the screen.
      const scale = Math.min((window.devicePixelRatio || 1) * 1.35, 2.0);
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      draw();
    }
    window.addEventListener('resize', resize);
    resize();

    // The room canvas is position:fixed (viewport-locked so it always fills
    // the screen — see .contact__room CSS), so it must only PAINT while the
    // contact section is on screen; otherwise it would sit over the other
    // sections. Toggle .is-visible (opacity) as the section enters/leaves, and
    // re-measure to the viewport on each approach.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          canvas.classList.toggle('is-visible', e.isIntersecting);
          if (e.isIntersecting) resize();
        });
      }, { rootMargin: '0px' }).observe(section);
    } else {
      canvas.classList.add('is-visible');
    }

    bootWarmups.push(() => { try { resize(); } catch (e) {} });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      lost = true;   // static layer degrades to transparent on GPU reset
    }, false);
  }

  /* -------------------------------------------------------
     Skills-warp portal — check-pattern tunnel fly-through.
     Same raw-WebGL skeleton as initHeroGrid (fullscreen
     triangle, DPR 1, IO-gated loop, perf-lite freeze,
     reduced-motion static frame). The shader looks down an
     endless pipe centered on the screen: polar uv → (angle
     sector, 1/r depth), and the walls carry the GALLERY
     backdrop's pattern — thin check lattice + brighter plus
     markers on a 3-cell tile, the plus layer riding slightly
     faster (same two-layer parallax as the gallery). Breathing
     barrel lens for warp, R/G/B sampled at offset radii for
     chromatic-aberration fringes in the old glitch title's
     red/lime/blue. Depth fog eats the center so the pipe
     vanishes into black; travel accelerates with scroll.
     ------------------------------------------------------- */
  function initWarpTunnel() {
    const canvas = document.getElementById('warpTunnel');
    const section = document.getElementById('skills');
    const pin = document.querySelector('.warp__pin');
    if (!canvas || !section || !pin) return;
    let gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: true, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: false, powerPreference: 'low-power',
      });
    } catch (e) { /* fall through */ }
    if (!gl) { canvas.remove(); return; }

    const VERT = [
      'attribute vec2 position;',
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = position * 0.5 + 0.5;',
      '  gl_Position = vec4(position, 0.0, 1.0);',
      '}',
    ].join('\n');

    const FRAG = [
      'precision highp float;',
      'uniform float iTime;',
      'uniform float uTravel;',
      'uniform vec2 iResolution;',
      'uniform vec2 uMouse;',
      'varying vec2 vUv;',
      'const float PI = 3.141592;',
      // Integer sector count → the pipe wall tiles seamlessly at ±PI.
      'const float SECTORS = 36.0;',
      'const float RINGS = 9.0;',
      // Global dimmer for the whole portal (radial rays + rings + crosses).
      // Kept below 1 so the tunnel reads as a faint background texture, never
      // competing with the flying skill cards / HUD in the foreground — but
      // high enough that the rays stay just perceptible (0.55 read as invisible).
      'const float OPACITY = 0.75;',
      'vec2 polar(vec2 p) {',
      '  float r = max(length(p), 1e-4);',
      '  float a = atan(p.y, p.x);',
      // Slow axial roll — the whole pipe turns almost imperceptibly,
      // so the walls never read as a frozen radial print.
      '  return vec2(a * (SECTORS / (2.0 * PI)) + iTime * 0.06, (0.30 / r) * RINGS);',
      '}',
      // The gallery backdrop's two layers, wrapped into a pipe:
      // thin check lattice (the 88px line grid, dim)...
      'float lat(vec2 p) {',
      '  vec2 tuv = polar(p);',
      '  tuv.y += uTravel;',
      '  vec2 f = abs(fract(tuv) - 0.5);',
      '  float lines = smoothstep(0.40, 0.48, max(f.x, f.y)) * 0.40;',
      // Fine 3x subdivision along DEPTH only — intermediate rings
      // nested between the cells (sub-ring : cell : plus-tile), so
      // the pipe reads as depth-on-depth without angular clutter.
      '  float f2 = abs(fract(tuv.y * 3.0) - 0.5);',
      '  float sub = smoothstep(0.42, 0.49, f2) * 0.13;',
      '  return max(lines, sub);',
      '}',
      // ...and long thin-stroke crosses on a 3-cell tile (264px on
      // 88px), riding a touch faster for the same two-layer parallax.
      'float plusMark(vec2 p) {',
      '  vec2 tuv = polar(p);',
      '  tuv.y += uTravel * 1.35;',
      '  vec2 q = abs(fract(tuv / 3.0 + 0.5) - 0.5) * 3.0;',
      // Long hairline arms — the crosses span over a full lattice
      // cell, thin as wire; their color (the section's chartreuse
      // accent) is applied in main().
      '  float ph = (1.0 - smoothstep(0.60, 0.70, q.x)) * (1.0 - smoothstep(0.022, 0.055, q.y));',
      '  float pv = (1.0 - smoothstep(0.60, 0.70, q.y)) * (1.0 - smoothstep(0.022, 0.055, q.x));',
      '  return max(ph, pv);',
      '}',
      'void main() {',
      '  vec2 uv = vUv * 2.0 - 1.0;',
      '  uv.x *= iResolution.x / iResolution.y;',
      // Hover response has TWO coupled parts, both off the same cursor:
      //   1. this shader shifts the vanishing point toward the cursor
      //      (uMouse, -1..1) so you visibly look AROUND inside the pipe —
      //      the part you can actually see on a symmetric fullscreen radial;
      //   2. a matching perspective + rotateX/rotateY CSS tilt on the
      //      canvas (applyTilt) keeps it in the warp cards' 3D system.
      // Together the portal reads as the same 3D environment reacting to
      // the cursor. The breathing barrel lens scales around the shifted axis.
      '  vec2 p = uv - uMouse * 0.08;',
      '  p *= 1.0 + 0.05 * sin(iTime * 0.33) * dot(p, p);',
      '  float r = length(p);',
      // Chromatic aberration — three radial samples, stronger at the
      // rim. The crosses get a much smaller offset than the lattice:
      // their hairline strokes would fully separate into detached
      // R/G/B stripes at the lattice's offset, while long lines only
      // fringe at their edges.
      '  float ab = 0.006 + 0.020 * r * r;',
      '  float pab = ab * 0.35;',
      '  float cr = lat(p * (1.0 - ab));',
      '  float cg = lat(p);',
      '  float cb = lat(p * (1.0 + ab));',
      '  float xr = plusMark(p * (1.0 - pab));',
      '  float xg = plusMark(p);',
      '  float xb = plusMark(p * (1.0 + pab));',
      // Lattice: channels overlap to the section's neutral warm cream
      // (the #ECE7DA family), fringing red / cyan-blue at the edges.
      '  vec3 col = cr * vec3(0.90, 0.22, 0.18)',
      '           + cg * vec3(0.72, 0.92, 0.45)',
      '           + cb * vec3(0.35, 0.72, 1.05);',
      '  col *= 0.5;',
      // Crosses: the section accent — channels sum to chartreuse
      // (the #D8FF38 family of the HUD and card labels). The trim
      // keeps them very, very subtle: the lime hue is what makes
      // them findable, not brightness.
      '  col += (xr * vec3(0.30, 0.18, 0.04)',
      '        + xg * vec3(0.62, 0.74, 0.15)',
      '        + xb * vec3(0.08, 0.22, 0.30)) * 0.15;',
      // Fog: the pipe vanishes into black down the center; soft rim
      // easing keeps the near wall from slamming into the vignette.
      '  float fog = smoothstep(0.03, 0.5, r);',
      '  fog *= 1.0 - 0.35 * smoothstep(1.1, 1.7, r);',
      // Fine grain shimmer so the plate never reads as a still.
      '  float grain = fract(sin(dot(gl_FragCoord.xy + iTime * 60.0, vec2(12.9898, 78.233))) * 43758.5453);',
      '  float m = max(col.r, max(col.g, col.b));',
      '  float alpha = clamp(m, 0.0, 1.0) * fog * OPACITY * (0.9 + 0.1 * grain);',
      '  gl_FragColor = vec4(col / max(m, 1e-3), alpha);',
      '}',
    ].join('\n');

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    }
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.remove(); return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const locPos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'iTime');
    const uRes = gl.getUniformLocation(prog, 'iResolution');
    const uTravel = gl.getUniformLocation(prog, 'uTravel');
    const uMouse = gl.getUniformLocation(prog, 'uMouse');
    // Smoothed pointer driving BOTH the shader vanishing-point shift and
    // the canvas perspective tilt on hover — the tilt uses the SAME
    // mapping as the warp world (initSkillsWarp: tiltX = mouseY*4,
    // tiltY = mouseX*4, perspective ~1000px), so the portal shares the
    // cards' 3D system. mouse.x/y are the normalized cursor (-1..1);
    // both ease back to 0 on leave.
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

    const reduce = !!(reduceMotionMQ && reduceMotionMQ.matches);
    // Travel accumulates (never jumps) so speed changes glide: a base
    // drift plus a smoothed, capped scroll-velocity boost — diving
    // through the skill stack accelerates the ride; scrolling back
    // reverses it.
    const BASE_SPEED = 0.45;         // depth cells / second
    const SCROLL_GAIN = 0.0011;      // px/s → extra cells/s
    const BOOST_CAP = 2.6;
    let travel = 0;
    let scrollVel = 0;
    let lastNow = 0;
    let lastY = 0;
    let raf = 0;
    let visible = true;
    const t0 = performance.now();

    function draw(now) {
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform1f(uTravel, travel);
      // Horizontal parallax is inverted (cursor right → pipe leans left);
      // vertical is the opposite sign (cursor down → pipe leans down), and
      // damped (×0.5) so up/down hover moves the portal less than left/right.
      gl.uniform2f(uMouse, -mouse.x, -mouse.y * 0.5);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    let lastTilt = '';
    function applyTilt() {
      // Same perspective + axes as the warp world's tilt (initSkillsWarp),
      // but INVERTED so the tilt leans opposite the cursor — in step with
      // the inverted vanishing-point shift above. scale(1.06) over-covers
      // so the tilt never exposes the dark pin behind the fullscreen
      // canvas edges. Written only on change — compositor-only, no repaint.
      // rotateX (vertical cursor) is damped vs rotateY (horizontal) so
      // up/down tilts less, and its sign is opposite rotateY's — the
      // vertical motion is inverted relative to the horizontal.
      const tiltX = (mouse.y * 0.9).toFixed(2);
      const tiltY = (-mouse.x * 1.8).toFixed(2);
      const key = tiltX + '_' + tiltY;
      if (key === lastTilt) return;
      lastTilt = key;
      canvas.style.transform =
        'perspective(1000px) rotateX(' + tiltX + 'deg) rotateY(' + tiltY + 'deg) scale(1.06)';
    }
    function tick(now) {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(Math.max((now - lastNow) / 1000, 0.001), 0.1);
      lastNow = now;
      const y = window.scrollY;
      scrollVel += ((y - lastY) / dt - scrollVel) * 0.08;
      lastY = y;
      const boost = Math.max(-BOOST_CAP, Math.min(BOOST_CAP, scrollVel * SCROLL_GAIN));
      travel += dt * (BASE_SPEED + boost);
      // Ease the tilt toward the cursor target (glide, no snap), then
      // write the matching 3D transform.
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      applyTilt();
      draw(now);
      // perf-lite can arrive later (adaptive FPS probe) — freeze on
      // this frame; the tunnel stays visible at zero ongoing cost.
      if (document.body.classList.contains('perf-lite')) return;
      raf = requestAnimationFrame(tick);
    }
    function kick() {
      if (raf || !visible || reduce) return;
      // Re-seed the clocks so a resume after an off-screen stretch
      // doesn't register as one giant dt / scroll spike.
      lastNow = performance.now();
      lastY = window.scrollY;
      raf = requestAnimationFrame(tick);
    }

    function resize() {
      // DPR capped at 1 — the walls are soft glow, not hairlines.
      const w = Math.max(1, pin.clientWidth);
      const h = Math.max(1, pin.clientHeight);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      if (reduce) { travel = 0.6; draw(t0); }   // one static frame
      else kick();
    }
    window.addEventListener('resize', resize);
    resize();

    // Boot warmup (sized first paint during the loader) + graceful context-loss.
    bootWarmups.push(() => { try { resize(); } catch (e) {} });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }, false);

    if (reduce) return;

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) kick();
        else if (raf) { cancelAnimationFrame(raf); raf = 0; }
      }).observe(section);
    }

    // Cursor-steered 3D tilt — mirrors the warp world's tilt input
    // exactly (same section, same normalized mouse, same axes). The
    // canvas is pointer-events:none, so these fire via the section's
    // descendants.
    section.addEventListener('mousemove', (e) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
    section.addEventListener('mouseleave', () => { mouse.tx = 0; mouse.ty = 0; }, { passive: true });

    kick();
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
    // Auto perf-lite detection REMOVED. The old FPS probe could add
    // `body.perf-lite` on a transient dip, which paused ambient animations to a
    // FROZEN frame — the "a visual gets stuck and never moves" symptom. We now
    // keep every device at full fidelity and rely on the boot-time preload +
    // WebGL warmups (and the GPU cost cuts already landed) to stay smooth.
    // Only the explicit ?lite=1 dev override still applies the lite CSS path;
    // perfProbeArmed stays false so runPerfProbe() is a no-op.
    if (new URLSearchParams(location.search).get('lite') === '1') {
      document.body.classList.add('perf-lite');
    }
  }

  function runPerfProbe() {
    if (!perfProbeArmed || perfProbeRan) return;
    perfProbeRan = true;

    const SETTLE  = 900;    // skip the reel's own start-up burst
    const SAMPLE  = 1600;   // measure over this window
    const THRESH  = 50;     // FPS below this → suspicious
    const CONFIRM = 2600;   // wait before the confirming second sample
    // ONE slow sample is not proof: right after the preloader hands off,
    // background frame decodes / shader compiles / font rasters can dip a
    // perfectly healthy machine below THRESH for a second or two — and the
    // old one-shot probe then froze the ambient visuals PERMANENTLY on
    // devices that were actually fine ("animations don't work on my other
    // desktop"). Perf-lite now needs TWO consecutive slow samples, the
    // second taken after the load rush has had time to clear.
    function sample(ms, cb) {
      let frames = 0;
      const start = performance.now();
      function count(now) {
        frames++;
        if (now - start < ms) { requestAnimationFrame(count); return; }
        cb((frames / (now - start)) * 1000);
      }
      requestAnimationFrame(count);
    }

    setTimeout(() => {
      if (document.hidden) { perfProbeRan = false; return; }  // can't judge a hidden tab; allow a later retry
      sample(SAMPLE, (fps) => {
        if (fps >= THRESH) return;                 // healthy — keep full visuals
        setTimeout(() => {
          if (document.hidden) { perfProbeRan = false; return; }
          sample(SAMPLE, (fps2) => {
            if (fps2 < THRESH) document.body.classList.add('perf-lite');
          });
        }, CONFIRM);
      });
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
    const starsEl = xpx2.querySelector('.xpx2__stars');
    const starsScroll = !(reduceMotionMQ && reduceMotionMQ.matches);
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

    // Boot warmup: pulse the globe active during the loading screen so its
    // vendor render loop compiles shaders + draws a couple of (off-screen,
    // opacity-0) frames — then power it back down. Moves the first-activation
    // hitch off the scroll and into the loader. Just toggles the same
    // data-active attribute the normal gating uses, so it's harmless if the
    // vendor globe isn't ready yet (it'll simply warm on scroll instead).
    bootWarmups.push(() => new Promise((resolve) => {
      if (!globe) { resolve(); return; }
      clearTimeout(globe.__pauseT);
      globe.setAttribute('data-active', '1');
      setTimeout(() => { globe.setAttribute('data-active', '0'); resolve(); }, 350);
    }));

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

      let lastSceneIdx = -1;
      const ioScene = new IntersectionObserver((es) => {
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          const i = panels.indexOf(e.target);
          if (sceneEl) sceneEl.textContent = e.target.getAttribute('data-scene') || '';
          dots.forEach((d, k) => d.classList.toggle('is-on', k === i));
          // Auto-run the title scramble each time a new experience becomes
          // the centered/active one, so its heading animates in on appear —
          // mirrors the gallery's per-project title animation (see updateUI).
          // Guarded on index change so scroll jitter across the center band
          // can't re-trigger the same title mid-animation.
          if (i !== lastSceneIdx) {
            lastSceneIdx = i;
            const host = e.target.querySelector('.xpcard__title .text-scramble');
            if (host && host.runScramble) host.runScramble();
          }
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
          // Drive the starfield from scroll: the px scrolled through the
          // section feeds a repeating-background offset, so as you scroll
          // down the stars slide up and new ones tile in from the bottom.
          if (starsEl && starsScroll) {
            const scrolledPx = self.progress * (self.end - self.start);
            starsEl.style.setProperty('--starY', scrolledPx.toFixed(1));
          }
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
     initXpArrow — cursor-follow guide arrow (vanilla port of the
     canvas arrow in dynamic-hero.tsx). A dashed, curved accent
     arrow trails the pointer and always points at whichever
     experience role title is currently centered in the viewport,
     so as you scroll it re-aims from one title to the next.
     Draws only while the section is on screen; skipped under
     reduced motion.
     ------------------------------------------------------------ */
  function initXpArrow() {
    const canvas = document.querySelector('[data-xp-arrow]');
    const xpx2 = document.querySelector('[data-xpx2]');
    const section = document.getElementById('experience');
    if (!canvas || !xpx2 || !section) return;
    if (reduceMotionMQ && reduceMotionMQ.matches) return;

    const ctx = canvas.getContext('2d');
    // The role names we can aim at (the big scramble word inside each title).
    const targets = [...xpx2.querySelectorAll('.xpcard__title .text-scramble')];
    if (!targets.length) return;

    const ACCENT = { r: 216, g: 255, b: 56 };   // electric chartreuse
    const mouse = { x: null, y: null };
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let running = false;
    let rafId = null;

    const sizeCanvas = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();

    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onResize = () => sizeCanvas();
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('resize', onResize);

    // Pick the title whose vertical center is nearest the viewport center —
    // that's the "active" role while scrolling through the pinned panels.
    const activeTarget = () => {
      const midY = window.innerHeight / 2;
      let best = null, bestD = Infinity;
      for (const el of targets) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const d = Math.abs(r.top + r.height / 2 - midY);
        if (d < bestD) { bestD = d; best = r; }
      }
      return best;
    };

    const draw = () => {
      const w = window.innerWidth, h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      if (mouse.x === null) return;
      const rect = activeTarget();
      if (!rect) return;

      const x0 = mouse.x, y0 = mouse.y;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Aim the arrowhead at the edge of the title (a little padding out).
      const a = Math.atan2(cy - y0, cx - x0);
      const x1 = cx - Math.cos(a) * (rect.width / 2 + 14);
      const y1 = cy - Math.sin(a) * (rect.height / 2 + 14);

      const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
      const offset = Math.min(200, Math.hypot(x1 - x0, y1 - y0) * 0.5);
      const t = Math.max(-1, Math.min(1, (y0 - y1) / 200));
      const controlX = midX;
      const controlY = midY + offset * t;

      const r = Math.hypot(x1 - x0, y1 - y0);
      // Keep it VERY subtle: slow fade-in with distance, capped at a low
      // opacity, thin hairline, and no glow — a faint hint, not a highlight.
      const opacity = Math.max(0, Math.min(0.28, (r - Math.max(rect.width, rect.height) / 2) / 900));
      if (opacity <= 0.01) return;

      ctx.strokeStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${opacity})`;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.shadowBlur = 0;

      // Curved dashed shaft.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(controlX, controlY, x1, y1);
      ctx.setLineDash([10, 6]);
      ctx.stroke();
      ctx.restore();

      // Small arrowhead at the title end.
      const angle = Math.atan2(y1 - controlY, x1 - controlX);
      const head = 8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    };

    const loop = () => {
      if (!running) return;
      draw();
      rafId = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };

    // Only run the loop while the experience section is on screen.
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.create({
        trigger: section, start: 'top bottom', end: 'bottom top',
        onToggle: (self) => (self.isActive ? start() : stop()),
      });
    } else if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => (es[0].isIntersecting ? start() : stop()), { threshold: 0 })
        .observe(section);
    } else {
      start();
    }
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

  /* ------------------------------------------------------------
     initContactWeave — "woven light" backdrop for the contact
     headline (vanilla port of woven-light-hero.tsx). A torus-knot
     shaped cloud of fine particles turns slowly behind the type
     and shies away from the cursor. Recoloured to the page — warm
     graphite threads with occasional chartreuse filaments on the
     cream, multiply-blended so it reads as woven thread, not neon.
     Allocation-free physics + trimmed particle count; only renders
     while the contact section is on screen; static under
     reduced-motion.
     ------------------------------------------------------------ */
  function initContactWeave() {
    const canvas = document.querySelector('[data-contact-weave]');
    const section = document.getElementById('contact');
    const inner = section && section.querySelector('.contact__inner');
    const headline = inner && inner.querySelector('.contact__headline');
    if (!canvas || !section || !inner || !headline) return;
    if (typeof THREE === 'undefined') return;

    const reduce = reduceMotionMQ && reduceMotionMQ.matches;
    const lite = document.body.classList.contains('perf-lite');
    const COUNT = lite ? 4400 : 9500;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Soft, sub-pixel points → 1.5 is indistinguishable from 2 here but renders
    // ~44% fewer fragments across the fullscreen particle field each frame.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.z = 5;
    camera.rotation.z = Math.PI / 2;   // roll the view 90° so the knot lies horizontal

    // Sample the knot's surface for particle seed positions. NOTE: THREE's
    // torus knot spans ~radius*1.5 + tube in-plane, so at camera z=5 (visible
    // half-height ~3.84) these values keep the whole knot inside the frame with
    // a comfortable margin — fills the screen but is never clipped.
    const knot = new THREE.TorusKnotGeometry(1.42, 0.42, 220, 30);
    const knotPos = knot.attributes.position;
    const vCount = knotPos.count;

    const positions = new Float32Array(COUNT * 3);
    const original = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);

    const graphite = new THREE.Color();
    const accent = new THREE.Color(0x9bbe18);   // muted deep chartreuse
    for (let i = 0; i < COUNT; i++) {
      const v = (i * 2654435761 % vCount);       // spread across the surface
      const x = knotPos.getX(v), y = knotPos.getY(v), z = knotPos.getZ(v);
      const k = i * 3;
      positions[k] = original[k] = x;
      positions[k + 1] = original[k + 1] = y;
      positions[k + 2] = original[k + 2] = z;
      // ~1 in 6 particles is an accent filament; the rest are warm graphite
      // with a little tonal jitter so the weave has depth.
      if (i % 6 === 0) {
        colors[k] = accent.r; colors[k + 1] = accent.g; colors[k + 2] = accent.b;
      } else {
        const t = 0.14 + Math.random() * 0.12;   // warm dark grey
        graphite.setRGB(t * 1.05, t, t * 0.82);
        colors[k] = graphite.r; colors[k + 1] = graphite.g; colors[k + 2] = graphite.b;
      }
    }
    knot.dispose();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: lite ? 0.05 : 0.038,
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.rotation.y = 0.5;   // slight lean for depth (camera is rolled 90°)
    // Camera rolled 90°: +Y shifts right, -X shifts up on screen. Keep the
    // up-shift modest so the top of the knot never clips the frame.
    points.position.y = 1.75;   // further right → wider gap from the text
    points.position.x = -0.1;   // a little lower (screen-down = world +X)
    scene.add(points);

    // Floor contact shadow — a soft, flattened ellipse a little below the knot
    // so it reads as levitating over a surface that catches its shadow. Static
    // (added to the scene, not the spinning points) and drawn BEHIND the knot;
    // darkens the cream through the canvas's multiply blend. Under the 90°
    // camera roll, screen-down = world +X and screen-horizontal = world Y, so a
    // wide/short sprite scale gives a floor ellipse in perspective.
    const shadeCv = document.createElement('canvas');
    shadeCv.width = shadeCv.height = 128;
    const sg = shadeCv.getContext('2d');
    const grd = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(20, 17, 10, 0.9)');
    grd.addColorStop(0.45, 'rgba(20, 17, 10, 0.4)');
    grd.addColorStop(1, 'rgba(20, 17, 10, 0)');
    sg.fillStyle = grd; sg.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(shadeCv),
      transparent: true, depthTest: false, depthWrite: false, opacity: 0.55,
    }));
    shadow.position.set(3.15, points.position.y, 0);  // just below the knot, same horizontal
    shadow.scale.set(4.6, 0.95, 1);                   // wide + flat floor ellipse
    shadow.renderOrder = -1;                          // behind the knot
    scene.add(shadow);

    // The canvas is viewport-SIZED (so the knot's framing/perspective is
    // unchanged) but ABSOLUTELY positioned within the section: its vertical
    // centre is pinned to the copy's visual centre, so the knot rests beside
    // the text and scrolls WITH the section instead of staying fixed to the
    // viewport. left:50%/translateX(-50%) keeps it horizontally centred.
    const place = () => {
      const w = window.innerWidth, h = window.innerHeight;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      // Anchor the canvas centre (= knot centre) to the copy's visual centre,
      // excluding the inner's bottom padding so it tracks the text, not the box.
      const padB = parseFloat(getComputedStyle(inner).paddingBottom) || 0;
      const contentCenter = inner.offsetTop + (inner.offsetHeight - padB) / 2;
      canvas.style.top = Math.round(contentCenter - h / 2) + 'px';
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    // Cursor → world (on the z=0 plane) for the repulsion, in canvas space.
    const mouse = { x: 0, y: 0, active: false };
    const halfH = () => Math.tan((75 * Math.PI / 180) / 2) * camera.position.z;
    if (!reduce) {
      window.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        if (!r.width) return;
        mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
        mouse.active = e.clientX >= r.left - 220 && e.clientX <= r.right + 220 &&
                       e.clientY >= r.top - 220 && e.clientY <= r.bottom + 220;
      }, { passive: true });
    }

    const R = 1.5, R2 = R * R;
    let running = false, rafId = null, last = performance.now();

    const step = (now) => {
      if (!running) return;
      const dt = Math.min((now - last) / 16.67, 2);   // frame-normalised
      last = now;
      const pos = geometry.attributes.position.array;
      const hh = halfH(), hw = hh * camera.aspect;
      // Camera is rolled 90° (screen-right → world +Y, screen-up → world -X),
      // so map the cursor into world space; then subtract the knot's position
      // offset so the repulsion is computed in the particles' local frame.
      const mx = -mouse.y * hh - points.position.x;
      const my = mouse.x * hw - points.position.y;
      const pushing = mouse.active;

      for (let i = 0; i < COUNT; i++) {
        const k = i * 3, k1 = k + 1, k2 = k + 2;
        let px = pos[k], py = pos[k1], pz = pos[k2];
        let vx = velocities[k], vy = velocities[k1], vz = velocities[k2];

        if (pushing) {
          const dx = px - mx, dy = py - my, dz = pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < R2) {
            const d = Math.sqrt(d2) || 0.0001;
            const f = (R - d) * 0.009 / d;
            vx += dx * f; vy += dy * f; vz += dz * f;
          }
        }
        // spring back to the woven seed position, then damp
        vx += (original[k] - px) * 0.013;
        vy += (original[k1] - py) * 0.013;
        vz += (original[k2] - pz) * 0.013;
        vx *= 0.90; vy *= 0.90; vz *= 0.90;

        pos[k] = px + vx * dt;
        pos[k1] = py + vy * dt;
        pos[k2] = pz + vz * dt;
        velocities[k] = vx; velocities[k1] = vy; velocities[k2] = vz;
      }
      geometry.attributes.position.needsUpdate = true;
      // Camera is rolled 90°, so spin about world X → an on-screen turntable
      // (horizontal) rotation, matching the original motion.
      points.rotation.x += 0.0016 * dt;

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(step);
    };

    const start = () => {
      if (running) return;
      place();
      canvas.classList.add('is-live');
      if (reduce) { renderer.render(scene, camera); return; }   // static frame
      running = true; last = performance.now();
      rafId = requestAnimationFrame(step);
    };
    const stop = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      // Fade out + stop the rAF when the section leaves the viewport (pure
      // perf — the canvas now scrolls off with the section on its own).
      canvas.classList.remove('is-live');
    };

    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { place(); if (reduce && canvas.classList.contains('is-live')) renderer.render(scene, camera); }, 140);
    });
    if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.addEventListener('refresh', place);

    // Boot warmup: compile the particle material + render one static frame
    // during the loading screen so the contact knot never hitches on entry.
    bootWarmups.push(() => { try { place(); renderer.render(scene, camera); } catch (e) {} });
    // Graceful context-loss: stop the loop (THREE clears the buffer); on
    // restore, THREE re-uploads and we resume if the section is on screen.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      try { if (canvas.classList.contains('is-live')) start(); } catch (e) {}
    }, false);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => (es[0].isIntersecting ? start() : stop()), { threshold: 0, rootMargin: '-8% 0px -8% 0px' })
        .observe(section);
    } else {
      start();
    }
  }

  /* -------------------------------------------------------
     initXpGrid — perspective morph for the experience grid.
     The .xp-gridwrap sticky window (styles.css) pins the
     lattice behind the whole section; this scrubs the
     rotation carrier from the gallery wall's on-screen pose
     (receding to the right) to a flatter resting tilt as the
     section scrolls into view — the grid reads as ONE surface
     smoothly re-orienting across the section boundary. The
     drift animation lives on the child plane (compositor), so
     the scrub and the drift never fight.
     ------------------------------------------------------- */
  function initXpGrid() {
    const tilt = document.getElementById('xpGridTilt');
    const sec = document.getElementById('experience');
    if (!tilt || !sec) return;
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined' ||
        (reduceMotionMQ && reduceMotionMQ.matches)) {
      return;                                     // static straight grid
    }
    // Perspective morph across the boundary: enters in the gallery
    // wall's pose, settles STRAIGHT (flat-on) once the section owns
    // the screen.
    gsap.fromTo(tilt,
      { rotationY: -16, rotationX: 4 },          // ≈ the gallery wall's read
      {
        rotationY: 0,
        rotationX: 0,                             // settled: straight
        ease: 'none',
        scrollTrigger: {
          trigger: sec,
          start: 'top bottom',
          end: 'top top',
          scrub: true
        }
      });
    // Scroll-follow: the lattice is attached to the background — it
    // translates 1:1 with the page scroll, wrapped every 264px (one
    // tile) so the periodic pattern never runs off the plane. Lives on
    // its own carrier so it composes with the rotation scrub (above)
    // and the CSS drift (child) instead of fighting them.
    const scrollEl = sec.querySelector('.xp-grid__scroll');
    if (scrollEl) {
      const setY = gsap.quickSetter(scrollEl, 'y', 'px');
      ScrollTrigger.create({
        trigger: sec,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          const total = sec.offsetHeight + window.innerHeight;
          setY(-((self.progress * total) % 264));
        }
      });
    }
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
    initGoodPart();
    initWelcomeBreath();
    initHeroGrid();
    initContactRoom();
    initWarpTunnel();
    initBlurAside();
    heroTerminal = initHeroTerminal();
    callcard = initCallcard();
    initTestimonials();
    initIgPost();
    initIgStories();
    initIgBio();
    initIgUiTilt();
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

    // XP grid perspective morph — created AFTER the gallery's triggers
    // (the experience section sits below it, keeping refresh order
    // top-to-bottom per GSAP guidance).
    initXpGrid();

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

    // Cursor-follow guide arrow that points at the active experience title.
    initXpArrow();

    // Woven-light torus-knot backdrop behind the contact headline.
    initContactWeave();

    // Light → dark "lights off" theme flip at the gallery→experience boundary.
    initThemeShift();

    // Scroll-drawn blueprint frame that wraps the experience page.
    initXpFrame();

    // Paint frame 0 right away so the hero never looks empty.
    renderFrame(0, false);

    // ---- Boot readiness ----
    // Preload the reel frames (priority order; drives 80% of the loader bar via
    // updateLoadingUI), await fonts, warm every cached asset (section-frames +
    // first IG slides) and every WebGL scene (shaders compiled, video/globe
    // textures uploaded, one frame rendered). The intro curtain waits on the
    // combined bootReady before it lifts — so the hero AND every downstream
    // section is ready the instant it clears. Every task is failure-tolerant so
    // one bad asset can never stall the loader. Contexts were created by the
    // init* calls above, so bootWarmups / extraPreload are already populated.
    const framesTask = preloadAll().then(() => {
      lastDrawnFrame = -1;
      renderFrame(frameState.idx, false);
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
    });
    const bootReady = Promise.all([
      framesTask.catch(() => {}),
      trackBoot(fontsReady()),
      trackBoot(preloadUrlList(extraPreload)),
    ].concat(bootWarmups.map((w) => trackBoot(Promise.resolve().then(w)))));

    // Play the first-paint reveal. The loader greets, then HOLDS until bootReady
    // resolves (or a hard cap) before lifting. If GSAP / the loader element are
    // missing, it hands off immediately.
    initPreloader(bootReady);

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
