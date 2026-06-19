const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2539,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2539, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  // PIN is-revealed on (defeat the auto-reel re-toggling) until we choose to release
  await page.evaluate(()=>{
    const a=document.getElementById('cinemaAsideLeft');
    const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1';
    window.__pin=true;
    const keep=new MutationObserver(()=>{ if(window.__pin && !a.classList.contains('is-revealed')) a.classList.add('is-revealed'); });
    keep.observe(a,{attributes:true,attributeFilter:['class']});
    a.classList.add('is-revealed');
  });
  // poll until fully written
  let on=0; for(let k=0;k<40;k++){ on=await page.evaluate(()=>[...document.querySelectorAll('.igbio__ch')].filter(c=>c.classList.contains('is-on')).length); if(on>=239)break; await sleep(80); }
  console.log('after write, on =', on, '/ 239');
  // release pin and hide once
  await page.evaluate(()=>{ window.__pin=false; document.getElementById('cinemaAsideLeft').classList.remove('is-revealed'); });
  const snap=()=>page.evaluate(()=>{ const c=[...document.querySelectorAll('.igbio__ch')]; const off={}; c.forEach(x=>{if(!x.classList.contains('is-on')){const t=x.offsetTop; off[t]=(off[t]||0)+1;}}); return {on:c.filter(x=>x.classList.contains('is-on')).length, linesErasing:Object.keys(off).length}; });
  for(const t of [120,260,400,540,700]){ await sleep(t===120?120:140); console.log('t='+t+'ms', JSON.stringify(await snap())); }
  await browser.close();
})();
