const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2546,1315'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2546, height:1315, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  await sleep(1200);
  async function measure(persp, origin) {
    await page.evaluate((p,o)=>{ const fx=document.querySelector('.igperspective'); fx.style.perspective=p+'px'; document.querySelector('.igstage').style.transformOrigin=o; }, persp, origin);
    await sleep(150);
    return await page.evaluate(()=>{
      const tops = el => [...document.querySelectorAll(el)].map(r=>r.getBoundingClientRect().top);
      const ring=tops('.igstory__ring'); const dockBtn=tops('.igdock__btn');
      const sl = a => Math.round(Math.max(...a)-Math.min(...a));
      return { ringSlope: sl(ring), dockSlope: sl(dockBtn) };
    });
  }
  for (const p of [1500, 2200, 3000, 4000]) {
    console.log('persp', p, 'origin center =>', JSON.stringify(await measure(p,'center')));
  }
  console.log('--- origin top ---');
  for (const p of [1500, 2200]) {
    console.log('persp', p, 'origin top =>', JSON.stringify(await measure(p,'50% 0%')));
  }
  await browser.close();
})();
