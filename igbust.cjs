const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
  const grab = async () => {
    const page = await browser.newPage();
    await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
    const r = await page.evaluate(()=>[...document.querySelectorAll('.igstory__avatar')].map(im=>({src:im.getAttribute('src'), loaded:im.complete&&im.naturalWidth>0})));
    await page.close();
    return r;
  };
  const a = await grab();
  await new Promise(r=>setTimeout(r,30));
  const b = await grab();
  console.log('LOAD 1:'); a.forEach(x=>console.log('  ', x.src, x.loaded?'[loaded]':'[FAILED]'));
  const t1 = a[1].src.split('?t=')[1], t2 = b[1].src.split('?t=')[1];
  console.log('gym token load1:', t1, ' load2:', t2, ' differ(always-fresh):', t1!==t2);
  console.log('allCoversBusted:', a.slice(1).every(x=>/\?t=\d+$/.test(x.src)));
  console.log('ppicNotBusted:', a[0].src==='ppic.jpg');
  console.log('allLoaded:', a.every(x=>x.loaded));
  await browser.close();
})();
