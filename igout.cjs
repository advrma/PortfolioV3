const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2539,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2539, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  await sleep(1500);
  const snap = ()=>page.evaluate(()=>{
    const chars=[...document.querySelectorAll('.igbio__ch')];
    const linesErasing={};
    chars.forEach(c=>{ if(!c.classList.contains('is-on')){ const t=c.offsetTop; linesErasing[t]=(linesErasing[t]||0)+1; } });
    return { on: chars.filter(c=>c.classList.contains('is-on')).length, total: chars.length, linesWithSomeOff: Object.keys(linesErasing).length };
  });
  console.log('fully shown:', JSON.stringify(await snap()));
  await page.evaluate(()=>document.getElementById('cinemaAsideLeft').classList.remove('is-revealed'));
  await sleep(130); console.log('erase t=130ms:', JSON.stringify(await snap()));
  await sleep(300); console.log('erase t=430ms:', JSON.stringify(await snap()));
  await sleep(700); console.log('erase t=1130ms:', JSON.stringify(await snap()));
  await browser.close();
})();
