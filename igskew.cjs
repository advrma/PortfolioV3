const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2546,1315'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2546, height:1315, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  await sleep(1500); // settle slide; cursor untouched so iguicard tilt = 0
  const rects = await page.evaluate(()=>[...document.querySelectorAll('.igstory__ring')].map(r=>{ const b=r.getBoundingClientRect(); return {cx:Math.round(b.x+b.width/2), cyTop:Math.round(b.top), h:Math.round(b.height), w:Math.round(b.width)}; }));
  const tops = rects.map(r=>r.cyTop);
  console.log(JSON.stringify(rects,null,2));
  console.log('top edge slope L->R (px):', Math.max(...tops)-Math.min(...tops));
  console.log('height L->R:', rects.map(r=>r.h).join(', '));
  await browser.close();
})();
