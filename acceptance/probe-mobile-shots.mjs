// 移动端验收出图（1920×1080 之外的移动端三张）。
// 为什么要自己写：scripts/box-browser.mjs 的移动端自检要求「没有任何元素超出视口 8px」，
// 而 MA 2.10.6 前端自带 sonner 的 toast 容器 ol.toaster.group 是 position:fixed、
// 宽度恒等于视口宽度、带 24px 右侧偏移，于是右边缘天然超出 8px —— 它是空的、固定定位、
// 不产生横向滚动（documentElement.scrollWidth == innerWidth）。这里把这个已知项单列出来，
// 其余仍然严格判定，并打印判定依据。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PP = process.env.PUPPETEER_CORE_DIR || '/lzcapp/document/wans/lpk-skill/node_modules';
const require = createRequire(path.join(PP, 'noop.js'));
const pkgDir = path.dirname(require.resolve('puppeteer-core/package.json'));
const puppeteer = (await import(pathToFileURL(path.join(pkgDir, 'lib/puppeteer/puppeteer-core.js')).href)).default;

const CDP = process.env.CDP || 'http://127.0.0.1:19337';
const BASE = process.env.BASE_URL || 'https://musicassistant.wans.heiyu.space';
const OUT = process.env.OUT || '/tmp/ma-acc/shots-mobile';
fs.mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PAGES = [['01', '/#/discover'], ['02', '/#/tracks'], ['03', '/#/settings/providers']];

const browser = await puppeteer.connect({ browserURL: CDP });
const page = await browser.newPage();
await page.setUserAgent(UA);
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const rows = [];
for (const [idx, p] of PAGES) {
  await page.goto(BASE + '/' + p, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));
  const check = await page.evaluate(() => {
    const de = document.documentElement;
    const items = [...document.querySelectorAll('body *')].map((e) => {
      const r = e.getBoundingClientRect();
      return { el: e, r, name: `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}` };
    }).filter((x) => x.r.width > 0 && x.r.right - window.innerWidth > 8);
    const fixedToast = items.filter((x) => {
      const cs = getComputedStyle(x.el);
      return /^ol\.toaster/.test(x.name) && cs.position === 'fixed' && x.el.children.length === 0;
    });
    const other = items.filter((x) => !fixedToast.includes(x));
    return {
      innerWidth: window.innerWidth,
      docWidth: de.scrollWidth,
      overflowDoc: de.scrollWidth - window.innerWidth,
      viewportMeta: !!document.querySelector('meta[name=viewport]'),
      fixedEmptyToast: fixedToast.map((x) => `${x.name}@${Math.round(x.r.width)}px position=fixed children=0`),
      offenders: other.map((x) => `${x.name}@${Math.round(x.r.width)}px`).slice(0, 6),
      hasPasswordInput: document.querySelectorAll('input[type=password]').length,
      user: (document.querySelector('.sidebar-footer,.user-menu')?.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
    };
  });
  const ok = check.overflowDoc <= 8 && check.viewportMeta && check.innerWidth <= 430 && check.offenders.length === 0;
  const file = path.join(OUT, `mob${idx}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const buf = fs.readFileSync(file);
  rows.push({ page: p, ok, file, size: `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, ...check });
}
const allOk = rows.every((r) => r.ok);
console.log(JSON.stringify({ allOk, rows }, null, 1));
await page.close();
await browser.disconnect();
process.exit(allOk ? 0 : 2);
