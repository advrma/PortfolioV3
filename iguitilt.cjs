const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2541,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message)); page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text());});
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const struct = await page.evaluate(()=>{
    const fx=document.querySelector('.iguifx'), card=document.querySelector('.iguicard');
    return {
      hasFx:!!fx, hasCard:!!card,
      fxPerspective: fx?getComputedStyle(fx).perspective:null,
      cardWrapsCol: !!card && !!card.querySelector('.igcol'),
      panelOutsideFx: !!document.querySelector('.igstage > .igpanel') && (!fx||!fx.querySelector('.igpanel')),
      panelStaysFlat: getComputedStyle(document.querySelector('.igpanel')).transform
    };
  });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  await sleep(1500);
  const read = ()=>page.evaluate(()=>({ card:getComputedStyle(document.querySelector('.iguicard')).transform, stage:getComputedStyle(document.querySelector('.igstage')).transform }));
  const s0 = await read();
  await page.mouse.move(200,320); await sleep(450); const a = await read();
  await page.mouse.move(640,1050); await sleep(450); const b = await read();
  console.log('STRUCT', JSON.stringify(struct,null,2));
  console.log('stageFixed (panel Y tilt constant):', s0.stage===a.stage && a.stage===b.stage);
  console.log('uiTiltMoves:', a.card!==b.card && a.card!=='none');
  console.log('cardA', a.card);
  console.log('cardB', b.card);
  console.log('ERRORS:', errs.length?errs.join('\n'):'none');
  await browser.close();
})();
