const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2539,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2539, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  const errs=[]; page.on('pageerror',e=>errs.push('PE '+e.message)); page.on('console',m=>{if(m.type()==='error')errs.push('CE '+m.text());});
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  // sample shortly after reveal: how many DISTINCT lines have at least 1 char on? (parallel => many at once)
  await sleep(120);
  const early = await page.evaluate(()=>{
    const chars=[...document.querySelectorAll('.igbio__ch')];
    const onByLine={};
    chars.forEach(c=>{ if(c.classList.contains('is-on')){ const t=c.offsetTop; onByLine[t]=(onByLine[t]||0)+1; } });
    const totalLines = new Set(chars.map(c=>c.offsetTop)).size;
    return { linesWithCharsOn: Object.keys(onByLine).length, totalLines, totalOn: chars.filter(c=>c.classList.contains('is-on')).length, total: chars.length };
  });
  await sleep(1400);
  const done = await page.evaluate(()=>{ const c=[...document.querySelectorAll('.igbio__ch')]; return { on: c.filter(x=>x.classList.contains('is-on')).length, total: c.length }; });
  // now hide -> disappear
  await page.evaluate(()=>document.getElementById('cinemaAsideLeft').classList.remove('is-revealed'));
  await sleep(200);
  const leaving = await page.evaluate(()=>{ const b=document.querySelector('.igbio'); const cs=getComputedStyle(b); return { hasLeavingClass:b.classList.contains('igbio--leaving'), filter:cs.filter, opacity:cs.opacity, transform:cs.transform }; });
  console.log('EARLY (120ms):', JSON.stringify(early), '<- linesWithCharsOn≈totalLines means parallel');
  console.log('DONE (~1.5s): ', JSON.stringify(done));
  console.log('LEAVING:', JSON.stringify(leaving));
  console.log('ERRORS:', errs.length?errs.join('\n'):'none');
  await browser.close();
})();
