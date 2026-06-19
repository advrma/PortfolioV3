const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2539,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2539, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>{ const a=document.getElementById('cinemaAsideLeft'); const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; window.__pin=true; const k=new MutationObserver(()=>{ if(window.__pin&&!a.classList.contains('is-revealed'))a.classList.add('is-revealed'); }); k.observe(a,{attributes:true,attributeFilter:['class']}); a.classList.add('is-revealed'); });
  let on=0; for(let i=0;i<40;i++){ on=await page.evaluate(()=>[...document.querySelectorAll('.igbio__ch')].filter(c=>c.classList.contains('is-on')).length); if(on>=239)break; await sleep(80); }
  console.log('written:', on);
  await page.evaluate(()=>{ window.scrollBy(0,300); if(window.ScrollTrigger)ScrollTrigger.update(); });
  const series=[];
  for(const t of [150,300,450,600,800,1000,1300]){ await sleep(t===150?150:(t-series.lastT||150)); }
  // simpler: sample every 200ms for ~1.4s
  let prev=999, reappeared=false, samples=[];
  for(let i=0;i<8;i++){ await sleep(200); const c=await page.evaluate(()=>[...document.querySelectorAll('.igbio__ch')].filter(x=>x.classList.contains('is-on')).length); samples.push(c); if(c>prev+2) reappeared=true; prev=c; }
  console.log('post-scroll samples (every 200ms):', samples.join(' -> '));
  console.log('reappeared (count went UP mid-erase)?', reappeared);
  await browser.close();
})();
