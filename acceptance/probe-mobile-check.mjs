import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const PP = process.env.PUPPETEER_CORE_DIR || '/lzcapp/document/wans/lpk-skill/node_modules';
const require = createRequire(path.join(PP, 'noop.js'));
const pkgDir = path.dirname(require.resolve('puppeteer-core/package.json'));
const puppeteer = (await import(pathToFileURL(path.join(pkgDir, 'lib/puppeteer/puppeteer-core.js')).href)).default;
const browser = await puppeteer.connect({ browserURL: process.env.CDP });
const page = await browser.newPage();
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
await page.setUserAgent(UA);
for (const [w, h] of [[390, 844], [412, 915], [430, 932]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(process.env.BASE_URL + '/#/tracks', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 5000));
  const c = await page.evaluate(() => {
    const de = document.documentElement;
    const overflowDoc = de.scrollWidth - window.innerWidth;
    const wideList = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.right - window.innerWidth <= 8) return false;
      return true;
    }).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}@${Math.round(e.getBoundingClientRect().width)}`);
    const vp = !!document.querySelector('meta[name=viewport]');
    return { innerWidth: window.innerWidth, docWidth: de.scrollWidth, overflowDoc, wide: wideList.length, wideList: wideList.slice(0, 4), viewportMeta: vp };
  });
  console.log(w + 'x' + h, JSON.stringify(c));
}
await page.close(); await browser.disconnect();
