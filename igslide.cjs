const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2541,1312'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2541, height:1312, deviceScaleFactor:1 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }]);
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  // pre-reveal: both should be off-screen-left and share transition
  const pre = await page.evaluate(()=>{
    const p=getComputedStyle(document.querySelector('.igpanel')), f=getComputedStyle(document.querySelector('.iguifx'));
    const off = el => el.getBoundingClientRect().right < 5; // off screen left
    return {
      panelTransition: p.transitionProperty+' '+p.transitionDuration+' '+p.transitionTimingFunction,
      uiTransition: f.transitionProperty+' '+f.transitionDuration+' '+f.transitionTimingFunction,
      panelOffscreen: off(document.querySelector('.igpanel')),
      uiOffscreen: off(document.querySelector('.iguifx'))
    };
  });
  // reveal: both slide in
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  // mid-transition: both should be moving (right edge advancing)
  await sleep(300);
  const mid = await page.evaluate(()=>({ panelRight:Math.round(document.querySelector('.igpanel').getBoundingClientRect().right), uiRight:Math.round(document.querySelector('.iguifx').getBoundingClientRect().right) }));
  await sleep(1300);
  const done = await page.evaluate(()=>({ panelRight:Math.round(document.querySelector('.igpanel').getBoundingClientRect().right), uiRight:Math.round(document.querySelector('.iguifx').getBoundingClientRect().right) }));
  console.log('PRE', JSON.stringify(pre,null,2));
  console.log('transitionsMatch:', pre.panelTransition===pre.uiTransition);
  console.log('bothOffscreenAtRest:', pre.panelOffscreen && pre.uiOffscreen);
  console.log('mid (both advancing):', JSON.stringify(mid));
  console.log('done (both settled on-screen):', JSON.stringify(done));
  await browser.close();
})();
