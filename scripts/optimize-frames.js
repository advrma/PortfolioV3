/* =========================================================
   optimize-frames.js
   One-time (regenerable) hero-frame asset pipeline.

   Source: CYBERFICTION-IMAGES/maleNNNN.png  (300 frames, 1920x1080)
   The runtime only ever drew the CENTER 60% (1152x1080) of each
   frame (drawSingleFrame xCrop = 0.6). 1152/1080 = 16/15 = the
   canvas aspect-ratio, so cropping there reproduces the framing
   pixel-for-pixel while dropping the wasted transparent gutter.

   Emits two WebP sets:
     CYBERFICTION-WEBP/      300 frames, 1152x1080, q80   (capable)
     CYBERFICTION-WEBP-LOW/  every 3rd (~100), 640x600, q72 (weak)

   Run:  node scripts/optimize-frames.js
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'CYBERFICTION-IMAGES');
const HI_DIR = path.join(ROOT, 'CYBERFICTION-WEBP');
const LO_DIR = path.join(ROOT, 'CYBERFICTION-WEBP-LOW');

const TOTAL = 300;
const PAD = 4;
const PREFIX = 'male';

// Center 60% crop of the 1920x1080 source.
const CROP = { left: (1920 - 1152) / 2, top: 0, width: 1152, height: 1080 };

// Weak tier: emit ALL frames downscaled, so the runtime STEP (which
// frames to actually load) is decoupled from generation.
const LO_SIZE = { width: 640, height: 600 };

const name = (i) => `${PREFIX}${String(i).padStart(PAD, '0')}`;

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function run() {
  ensureDir(HI_DIR);
  ensureDir(LO_DIR);

  let hiBytes = 0, hiCount = 0;
  let loBytes = 0, loCount = 0;

  for (let i = 1; i <= TOTAL; i++) {
    const srcPath = path.join(SRC_DIR, name(i) + '.png');
    if (!fs.existsSync(srcPath)) {
      console.warn('missing source:', srcPath);
      continue;
    }
    const src = fs.readFileSync(srcPath);

    // High tier — every frame, full crop resolution.
    const hiPath = path.join(HI_DIR, name(i) + '.webp');
    await sharp(src)
      .extract(CROP)
      .webp({ quality: 80, effort: 5 })
      .toFile(hiPath);
    hiBytes += fs.statSync(hiPath).size;
    hiCount++;

    // Low tier — every frame, downscaled (runtime STEP picks which to load).
    const loPath = path.join(LO_DIR, name(i) + '.webp');
    await sharp(src)
      .extract(CROP)
      .resize(LO_SIZE.width, LO_SIZE.height)
      .webp({ quality: 72, effort: 5 })
      .toFile(loPath);
    loBytes += fs.statSync(loPath).size;
    loCount++;

    if (i % 25 === 0 || i === TOTAL) {
      process.stdout.write(`\r  processed ${i}/${TOTAL}`);
    }
  }

  const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
  console.log('\n');
  console.log(`HIGH  ${HI_DIR}`);
  console.log(`      ${hiCount} frames, ${mb(hiBytes)} (avg ${(hiBytes / hiCount / 1024).toFixed(1)} KB)`);
  console.log(`LOW   ${LO_DIR}`);
  console.log(`      ${loCount} frames, ${mb(loBytes)} (avg ${(loBytes / loCount / 1024).toFixed(1)} KB)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
