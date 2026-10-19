// Recon probe: what does the app render for a first-time reviewer, and is the
// passwordless inject actually executed? Prints compact JSON.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PP = process.env.PUPPETEER_CORE_DIR || '/lzcapp/document/wans/lpk-skill/node_modules';
const require = createRequire(path.join(PP, 'noop.js'));
const pkgDir = path.dirname(require.resolve('puppeteer-core/package.json'));
const puppeteer = (await import(pathToFileURL(path.join(pkgDir, 'lib/puppeteer/puppeteer-core.js')).href)).default;

const CDP = process.env.CDP || 'http://127.0.0.1:19335';
const BASE = process.env.BASE_URL || 'https://musicassistant.wans.heiyu.space';
const browser = await puppeteer.connect({ browserURL: CDP });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
const logs = [];
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (/lzc-ma-autologin|inject/i.test(t) || m.type() === 'error') logs.push(`${m.type()}: ${t.slice(0, 200)}`);
});
page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0].slice(0, 200)));
page.on('requestfailed', (r) => errors.push(`REQFAIL ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000));

const state = await page.evaluate(() => {
  const txt = (sel) => [...document.querySelectorAll(sel)].map((e) => (e.innerText || '').trim()).filter(Boolean);
  return {
    href: location.href,
    hash: location.hash,
    title: document.title,
    passwordInputs: document.querySelectorAll('input[type=password]').length,
    token: (() => { try { const t = localStorage.getItem('ma_access_token') || ''; return t ? `${t.slice(0, 18)}…len=${t.length}` : ''; } catch { return 'ERR'; } })(),
    bodyLen: (document.body.innerText || '').length,
    buttons: txt('button').slice(0, 24),
    headings: txt('h1,h2,h3,h4').slice(0, 24),
    bodyStart: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 900),
  };
});
await page.screenshot({ path: '/tmp/recon-01.png' });
console.log(JSON.stringify({ state, logs: logs.slice(0, 12), errors: errors.slice(0, 12) }, null, 1));
await page.close();
await browser.disconnect();
