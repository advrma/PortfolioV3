const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2542,1316'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2542, height:1316, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const r = await page.evaluate(()=>[...document.querySelectorAll('.igstory')].map(st=>{
    const ring=st.querySelector('.igstory__ring'), av=st.querySelector('.igstory__avatar');
    const acs=getComputedStyle(av), rcs=getComputedStyle(ring);
    return {
      label: st.querySelector('.igstory__label').textContent,
      ring: ring.offsetWidth+'x'+ring.offsetHeight,
      ringDisplay: rcs.display, ringTemplRows: rcs.gridTemplateRows,
      avatar: av.offsetWidth+'x'+av.offsetHeight,
      avatarObjFit: acs.objectFit,
      natural: av.naturalWidth+'x'+av.naturalHeight,
      overflowsRing: av.offsetHeight > ring.offsetHeight
    };
  }));
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})();
