const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=2540,1303'] });
  const page = await browser.newPage();
  await page.setViewport({ width:2540, height:1303, deviceScaleFactor:1 });
  await page.goto('http://localhost:8000/', { waitUntil:'networkidle2' });
  await page.evaluate(()=>{ const ov=document.getElementById('cinemaOverlay'); if(ov)ov.style.opacity='1'; document.getElementById('cinemaAsideLeft').classList.add('is-revealed'); });
  await sleep(1500);
  const at = async (label) => {
    const r = await page.evaluate(()=>[...document.querySelectorAll('.igstory__ring')].map(x=>{const b=x.getBoundingClientRect();return {w:+b.width.toFixed(1),h:+b.height.toFixed(1),ratio:+(b.width/b.height).toFixed(3)};}));
    console.log(label, JSON.stringify(r.map(x=>x.ratio)));
  };
  await at('REST (cursor away)     w/h:');
  // hover near the stories row (top-left area)
  await page.mouse.move(180, 130); await sleep(500);
  await at('HOVER top-left         w/h:');
  await page.mouse.move(520, 130); await sleep(500);
  await at('HOVER top-right        w/h:');
  await page.mouse.move(300, 900); await sleep(500);
  await at('HOVER bottom           w/h:');
  console.log('(ratio 1.0 = perfect circle; <1 = oval taller-than-wide)');
  await browser.close();
})();
