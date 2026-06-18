const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2541,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  const errs=[], imgs404=[];
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  page.on('requestfailed', r=>{ if(/instagram-images/.test(r.url())) imgs404.push(r.url()); });
  page.on('response', r=>{ if(/instagram-images/.test(r.url()) && r.status()>=400) imgs404.push(r.status()+' '+r.url()); });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const info = await page.evaluate(()=>{
    const slide=document.querySelector('.igpost__slide');
    return {
      dotCount: document.querySelectorAll('.igpost__dot').length,
      slideScale: slide?getComputedStyle(slide).scale:null
    };
  });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  const active = () => page.evaluate(()=>[...document.querySelectorAll('.igpost__dot')].findIndex(d=>d.classList.contains('is-active')));
  await sleep(300); const a0 = await active();
  await sleep(2200); const a1 = await active();   // after ~1 auto tick
  await sleep(2200); const a2 = await active();   // after ~2 auto ticks
  console.log('dotCount:', info.dotCount, '(want 14)');
  console.log('slideScale (want ~1.08):', info.slideScale);
  console.log('activeDot progression:', a0, '->', a1, '->', a2, '(should advance)');
  console.log('autoAdvances:', a0!==a1 && a1!==a2);
  console.log('imageErrors:', imgs404.length?imgs404.join('\n'):'none');
  console.log('pageErrors:', errs.length?errs.join('\n'):'none');
  await browser.close();
})();
