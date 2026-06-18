const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--incognito'] });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);   // fresh, no cache
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  const imgs = await page.evaluate(()=>[...document.querySelectorAll('.igstory__avatar')].map(im=>({
    src: im.getAttribute('src'),
    currentSrc: im.currentSrc.split('/').slice(-1)[0],
    loaded: im.complete && im.naturalWidth>0,
    dims: im.naturalWidth+'x'+im.naturalHeight
  })));
  console.log(JSON.stringify(imgs,null,2));
  await browser.close();
})();
