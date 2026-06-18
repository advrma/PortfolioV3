const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2539,1304'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2539, height:1304, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  await sleep(1500);
  const r = await page.evaluate(()=>{
    const p=document.querySelector('.igpanel'); const b=p.getBoundingClientRect();
    const cs=getComputedStyle(p);
    return { left:+b.left.toFixed(2), right:+b.right.toFixed(2), top:+b.top.toFixed(2), bottom:+b.bottom.toFixed(2), cssLeft:cs.left, cssWidth:cs.width };
  });
  console.log('panel rect:', JSON.stringify(r));
  console.log('gap at viewport left (left>0 means cream sliver):', r.left);
  await browser.close();
})();
