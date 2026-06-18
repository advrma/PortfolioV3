const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2546,1315'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2546, height:1315, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const data = await page.evaluate(()=>{
    const rowCS = getComputedStyle(document.querySelector('.igstories'));
    const stories = [...document.querySelectorAll('.igstory')].map(st=>{
      const ring = st.querySelector('.igstory__ring');
      const label = st.querySelector('.igstory__label');
      const img = st.querySelector('.igstory__avatar');
      const rcs = getComputedStyle(ring);
      return {
        storyOffTop: st.offsetTop, storyOffLeft: st.offsetLeft, storyW: Math.round(st.offsetWidth), storyH: Math.round(st.offsetHeight),
        ringOffTop: ring.offsetTop, ringW: Math.round(ring.offsetWidth), ringH: Math.round(ring.offsetHeight),
        ringW_cs: rcs.width, ringH_cs: rcs.height, ringFlexShrink: rcs.flexShrink,
        labelOffTop: label.offsetTop, label: label.textContent,
        imgNatural: img.naturalWidth+'x'+img.naturalHeight
      };
    });
    return { rowAlignItems: rowCS.alignItems, rowGap: rowCS.columnGap, rowJustify: rowCS.justifyContent, storyAlign: getComputedStyle(document.querySelector('.igstory')).alignItems, stories };
  });
  console.log(JSON.stringify(data,null,2));
  await browser.close();
})();
