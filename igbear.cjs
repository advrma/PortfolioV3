const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2546,1307'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2546, height:1307, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>document.fonts.ready);
  const r = await page.evaluate(()=>{
    const tcs=getComputedStyle(document.querySelector('.igpost__tag'));
    const lcs=getComputedStyle(document.querySelector('.igpost__loc'));
    const c=document.createElement('canvas').getContext('2d');
    c.font = tcs.fontWeight+' '+tcs.fontSize+' '+tcs.fontFamily;
    const a=c.measureText('adivrmaa');
    c.font = lcs.fontWeight+' '+lcs.fontSize+' '+lcs.fontFamily;
    const d=c.measureText('Dubai, United Arab Emirates');
    return {
      tagFont: tcs.fontWeight+' '+tcs.fontSize,
      locFont: lcs.fontWeight+' '+lcs.fontSize,
      tagBearingLeft: +a.actualBoundingBoxLeft.toFixed(2),
      locBearingLeft: +d.actualBoundingBoxLeft.toFixed(2),
      nudgeNeededPx: +(a.actualBoundingBoxLeft - d.actualBoundingBoxLeft).toFixed(2)
    };
  });
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})();
