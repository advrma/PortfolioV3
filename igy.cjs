const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1312, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const t = await page.evaluate(()=>getComputedStyle(document.querySelector('.igstage')).transform);
  const n = t.replace(/matrix3d\(|\)/g,'').split(',').map(Number);
  console.log('transform:', t);
  console.log('xLevel (m22==1 & m23==0):', Math.abs(n[5]-1)<1e-4 && Math.abs(n[6])<1e-4);
  console.log('yTilt deg (asin -m31... use asin(m13)):', (Math.asin(n[2])*180/Math.PI).toFixed(2));
  await browser.close();
})();
