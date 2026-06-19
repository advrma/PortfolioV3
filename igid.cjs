const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2546,1307'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2546, height:1307, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const r = await page.evaluate(()=>{
    const tag=document.querySelector('.igpost__tag'), loc=document.querySelector('.igpost__loc'), id=document.querySelector('.igpost__id');
    const tcs=getComputedStyle(tag), lcs=getComputedStyle(loc), ics=getComputedStyle(id);
    return {
      tagOffLeft: tag.offsetLeft, locOffLeft: loc.offsetLeft,
      tagRectLeft: +tag.getBoundingClientRect().left.toFixed(1), locRectLeft: +loc.getBoundingClientRect().left.toFixed(1),
      tag: { display: tcs.display, marginLeft: tcs.marginLeft, paddingLeft: tcs.paddingLeft, textIndent: tcs.textIndent, letterSpacing: tcs.letterSpacing, fontWeight: tcs.fontWeight, fontFamily: tcs.fontFamily.slice(0,30) },
      loc: { display: lcs.display, marginLeft: lcs.marginLeft, paddingLeft: lcs.paddingLeft, textIndent: lcs.textIndent, letterSpacing: lcs.letterSpacing, fontFamily: lcs.fontFamily.slice(0,30) },
      idAlign: ics.alignItems
    };
  });
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})();
