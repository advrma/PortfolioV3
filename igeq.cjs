const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1312, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const r = await page.evaluate(()=>{
    const cs=getComputedStyle(document.querySelector('.igstage'));
    return { transform: cs.transform, origin: cs.transformOrigin };
  });
  const nums = r.transform.replace(/matrix3d\(|\)/g,'').split(',').map(Number);
  console.log('transform:', r.transform);
  console.log('origin:', r.origin);
  console.log('yStraight (m11==1 & m13==0):', Math.abs(nums[0]-1)<1e-4 && Math.abs(nums[2])<1e-4);
  console.log('xTilt deg (asin m23):', (Math.asin(nums[6])*180/Math.PI).toFixed(2));
  await browser.close();
})();
