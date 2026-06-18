const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1312, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const t = await page.evaluate(()=>getComputedStyle(document.querySelector('.igstage')).transform);
  // parse matrix3d
  const nums = t.replace(/matrix3d\(|\)/g,'').split(',').map(Number);
  // m11=nums[0], m13=nums[2] (column-major: nums[0..3]=col0). rotateX-only => m11==1, m13==0
  console.log('transform:', t);
  console.log('m11 (cosY, want 1):', nums[0].toFixed(4));
  console.log('m13 (sinY, want 0):', nums[2].toFixed(4));
  console.log('yAxisStraight:', Math.abs(nums[0]-1)<1e-4 && Math.abs(nums[2])<1e-4);
  console.log('xTiltPresent (m23!=0):', Math.abs(nums[6])>1e-3);
  await browser.close();
})();
