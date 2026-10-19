// Prove the dead-end entry is gone: open Settings -> Music sources -> Add provider and list what's offered.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const PP = process.env.PUPPETEER_CORE_DIR || '/lzcapp/document/wans/lpk-skill/node_modules';
const require = createRequire(path.join(PP, 'noop.js'));
const pkgDir = path.dirname(require.resolve('puppeteer-core/package.json'));
const puppeteer = (await import(pathToFileURL(path.join(pkgDir, 'lib/puppeteer/puppeteer-core.js')).href)).default;
const browser = await puppeteer.connect({ browserURL: process.env.CDP });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(process.env.BASE_URL + '/#/settings/providers', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 6000));
const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button,a,[role=button]')].filter((e) => /添加新的提供程序|Add provider/i.test(e.innerText || '') && (e.offsetWidth || e.offsetHeight));
  if (!el.length) return false;
  el[0].click(); return true;
});
await new Promise((r) => setTimeout(r, 2500));
const list = await page.evaluate(() => {
  const txt = document.body.innerText || '';
  return {
    hasQQ: /QQ Music|QQ音乐/.test(txt),
    hasNetease: /NetEase|网易云/.test(txt),
    hasKugou: /Kugou|酷狗/.test(txt),
    dialogs: [...document.querySelectorAll('[role=dialog]')].map((d) => (d.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30)),
  };
});
await page.screenshot({ path: '/tmp/addprovider.png' });
console.log(JSON.stringify({ clicked, ...list }, null, 1));
await page.close(); await browser.disconnect();
