const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2541,1309'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1309, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>document.fonts && document.fonts.ready);
  await page.evaluate(()=>{ const a=document.getElementById('cinemaAsideLeft'); const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; window.__pin=true; const k=new MutationObserver(()=>{ if(window.__pin&&!a.classList.contains('is-revealed'))a.classList.add('is-revealed'); }); k.observe(a,{attributes:true,attributeFilter:['class']}); a.classList.add('is-revealed'); });
  await sleep(1000);
  const r = await page.evaluate(()=>{
    const tag=document.querySelector('.igpost__tag'), loc=document.querySelector('.igpost__loc');
    const rng=(el)=>{ const rg=document.createRange(); rg.setStart(el.firstChild,0); rg.setEnd(el.firstChild,1); return +rg.getBoundingClientRect().left.toFixed(1); };
    return { tagGlyphLeft: rng(tag), locGlyphLeft: rng(loc), tagTextAlign: getComputedStyle(tag).textAlign };
  });
  console.log(JSON.stringify(r));
  console.log('visual offset (want ~0):', (r.tagGlyphLeft - r.locGlyphLeft).toFixed(1), 'px');
  await browser.close();
})();
