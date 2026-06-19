const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2546,1307'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2546, height:1307, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const r = await page.evaluate(()=>{
    const tag=document.querySelector('.igpost__tag'), loc=document.querySelector('.igpost__loc');
    return { tagOffLeft: tag.offsetLeft, locOffLeft: loc.offsetLeft, tagMarginLeft: getComputedStyle(tag).marginLeft };
  });
  console.log(JSON.stringify(r), '-> tag now starts ~'+(r.locOffLeft - r.tagOffLeft)+'px left of location box');
  await browser.close();
})();
