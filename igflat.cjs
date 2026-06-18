const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2541,1308'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1308, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message)); page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text());});
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const s = await page.evaluate(() => {
    const stage=document.querySelector('.igstage');
    return {
      stageDirectChildren: stage ? [...stage.children].map(c=>c.className) : null,
      stageParentIsPerspective: stage && stage.parentElement.className === 'igperspective',
      noIgtilt: !document.querySelector('.igtilt'),
      noStageInner: !document.querySelector('.igstage-inner'),
      stageTransformStyle: getComputedStyle(stage).transformStyle,
      stageTransform: getComputedStyle(stage).transform,
      perspective: getComputedStyle(document.querySelector('.igperspective')).perspective
    };
  });
  // reveal + move cursor to confirm NOTHING changes (static)
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  await sleep(1500);
  const t1 = await page.evaluate(()=>getComputedStyle(document.querySelector('.igstage')).transform);
  await page.mouse.move(200,300); await sleep(300);
  await page.mouse.move(640,1000); await sleep(400);
  const t2 = await page.evaluate(()=>getComputedStyle(document.querySelector('.igstage')).transform);
  console.log(JSON.stringify(s,null,2));
  console.log('staysStaticOnCursor:', t1===t2);
  console.log('ERRORS:', errs.length?errs.join('\n'):'none');
  await browser.close();
})();
