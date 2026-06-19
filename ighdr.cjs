const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2541,1309'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1309, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>document.fonts && document.fonts.ready);
  // reveal + pin so the IG HTML renders on-screen for measurement/screenshot
  await page.evaluate(()=>{ const a=document.getElementById('cinemaAsideLeft'); const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; window.__pin=true; const k=new MutationObserver(()=>{ if(window.__pin&&!a.classList.contains('is-revealed'))a.classList.add('is-revealed'); }); k.observe(a,{attributes:true,attributeFilter:['class']}); a.classList.add('is-revealed'); });
  await sleep(1200);
  const r = await page.evaluate(()=>{
    const tag=document.querySelector('.igpost__tag'), loc=document.querySelector('.igpost__loc'), id=document.querySelector('.igpost__id');
    const tb=tag.getBoundingClientRect(), lb=loc.getBoundingClientRect(), ib=id.getBoundingClientRect();
    // Range rect of the FIRST glyph of each (where the text actually starts)
    const rng=(el)=>{ const rg=document.createRange(); rg.setStart(el.firstChild,0); rg.setEnd(el.firstChild,1); return +rg.getBoundingClientRect().left.toFixed(1); };
    return {
      tagBoxLeft:+tb.left.toFixed(1), locBoxLeft:+lb.left.toFixed(1), idLeft:+ib.left.toFixed(1),
      tagFirstGlyphLeft: rng(tag), locFirstGlyphLeft: rng(loc),
      tagMargin: getComputedStyle(tag).marginLeft, tagDisplay: getComputedStyle(tag).display,
      idAlign: getComputedStyle(id).alignItems, tagWidth:+tb.width.toFixed(0), idWidth:+ib.width.toFixed(0)
    };
  });
  console.log(JSON.stringify(r,null,2));
  console.log('visual offset (tag glyph - loc glyph):', (r.tagFirstGlyphLeft - r.locFirstGlyphLeft).toFixed(1), 'px (want ~0)');
  // screenshot the header
  const clip = await page.evaluate(()=>{ const h=document.querySelector('.igpost__header').getBoundingClientRect(); return {x:Math.max(0,h.left-10), y:Math.max(0,h.top-10), width:Math.min(700,h.width+40), height:h.height+20}; });
  await page.screenshot({ path:'C:/Users/XENOGO/AppData/Local/Temp/ighdr.png', clip });
  await browser.close();
})();
