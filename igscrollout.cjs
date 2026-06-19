const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2539,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2539, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  const errs=[]; page.on('pageerror',e=>errs.push('PE '+e.message)); page.on('console',m=>{if(m.type()==='error')errs.push('CE '+m.text());});
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  // Pin the aside revealed + let bio fully write (defeat the auto-reel toggling for the test)
  await page.evaluate(()=>{
    const a=document.getElementById('cinemaAsideLeft'); const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1';
    window.__pin=true; const keep=new MutationObserver(()=>{ if(window.__pin&&!a.classList.contains('is-revealed'))a.classList.add('is-revealed'); }); keep.observe(a,{attributes:true,attributeFilter:['class']}); a.classList.add('is-revealed');
  });
  let on=0; for(let k=0;k<40;k++){ on=await page.evaluate(()=>[...document.querySelectorAll('.igbio__ch')].filter(c=>c.classList.contains('is-on')).length); if(on>=239)break; await sleep(80); }
  console.log('written on =', on, '/239');
  // Simulate a real user scroll: scroll window + force ScrollTrigger.update with isAutoScrolling false
  const fired = await page.evaluate(()=>{
    window.scrollBy(0, 300);
    if (window.ScrollTrigger) ScrollTrigger.update();
    return true;
  });
  await sleep(150);
  const t1 = await page.evaluate(()=>[...document.querySelectorAll('.igbio__ch')].filter(c=>c.classList.contains('is-on')).length);
  await sleep(250);
  const t2 = await page.evaluate(()=>[...document.querySelectorAll('.igbio__ch')].filter(c=>c.classList.contains('is-on')).length);
  console.log('after user scroll: on@150ms=', t1, ' on@400ms=', t2, '  (should drop below 239 = disappearing)');
  console.log('disappearStarted:', t1 < 239 || t2 < 239);
  console.log('ERRORS:', errs.length?errs.join('\n'):'none');
  await browser.close();
})();
