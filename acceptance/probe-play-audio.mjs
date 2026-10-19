// 播放实测（驳回点 #20657 的正面证据）。
//
// 判定依据（两层，缺一不可）：
//   A. 服务端 player_queues/all：state=playing 且 elapsed_time 每 3 秒稳定 +3.00s
//      —— MA 的 elapsed 是由播放端（这里是浏览器 Web 播放器）回报的播放进度，
//         只有客户端真的在消费音频才会推进；卡住/失败会停在原地或报 streamdetails 错误。
//   B. 客户端 WebAudio 埋点（best-effort）：MA 用 sendspin + WebAudio 放音，没有 <audio> 元素，
//      因此统计 createBufferSource().start() 的次数与采样数 = 真正排进音频设备的 PCM。
//      当页面音频图被 Service Worker 接管时页面侧计不到（会记 0），此时以 A 为准并在报告里说明。
//
// 路径：先真的在「歌曲」页点行首播放按钮（UI 路径）；点不动才退化为同一条 RPC 命令，
//       并在输出里标注实际走的是哪条（不冒充 UI 点击）。
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PP = process.env.PUPPETEER_CORE_DIR || '/lzcapp/document/wans/lpk-skill/node_modules';
const require = createRequire(path.join(PP, 'noop.js'));
const pkgDir = path.dirname(require.resolve('puppeteer-core/package.json'));
const puppeteer = (await import(pathToFileURL(path.join(pkgDir, 'lib/puppeteer/puppeteer-core.js')).href)).default;

const CDP = process.env.CDP || 'http://127.0.0.1:19337';
const BASE = process.env.BASE_URL || 'https://musicassistant.wans.heiyu.space';
const TRACK_URI = process.env.TRACK_URI || 'library://track/1';
const TITLE = process.env.TRACK_TITLE || '示例曲目';
const SHOT = process.env.SHOT || '/tmp/ma-acc/shots/pc05__playback.png';

const browser = await puppeteer.connect({ browserURL: CDP });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.evaluateOnNewDocument(() => {
  window.__lzcAudio = { buffers: 0, samples: 0 };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const orig = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () {
    const src = orig.call(this);
    const start = src.start.bind(src);
    src.start = (...args) => {
      try {
        window.__lzcAudio.buffers += 1;
        window.__lzcAudio.samples += src.buffer ? src.buffer.length : 0;
      } catch { /* 埋点失败不影响播放 */ }
      return start(...args);
    };
    return src;
  };
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

await page.goto(`${BASE}/#/tracks`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

const queues = async () => page.evaluate(async () => {
  const tok = localStorage.getItem('ma_access_token') || '';
  const r = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ message_id: 1, command: 'player_queues/all', args: {} }),
  });
  let rows = [];
  try { rows = await r.json(); } catch { rows = []; }
  return rows.map((q) => ({
    player: q.display_name, state: q.state, items: q.items,
    current: q.current_item ? q.current_item.name : null,
    elapsed: +Number(q.elapsed_time || 0).toFixed(2),
  }));
});

const before = await page.evaluate(() => ({ ...window.__lzcAudio }));
// UI 路径：先真鼠标悬停到这一行（MA 的行首播放键是 hover 后才可点），
// 再用鼠标点它的中心坐标 —— 比 element.click() 更接近真人操作。
const spot = await page.evaluate((title) => {
  const leaves = [...document.querySelectorAll('*')]
    .filter((e) => (e.textContent || '').includes(title) && (e.textContent || '').length < 90);
  leaves.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
  const leaf = leaves[0];
  if (!leaf) return { err: 'row-not-found' };
  const rowOf = (leaf) => {
    let el = leaf;
    for (let i = 0; i < 10 && el.parentElement; i += 1) {
      el = el.parentElement;
      const r = el.getBoundingClientRect();
      if (r.height > 20 && r.height < 110 && r.width > 300) return el;
    }
    return null;
  };
  const row = rowOf(leaf);
  if (!row) return { err: 'row-not-found' };
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}, TITLE);
let clickResult = 'row-not-found';
if (!spot.err && spot.w > 0) {
  await page.mouse.move(spot.x + 24, spot.y + spot.h / 2);
  await new Promise((r) => setTimeout(r, 600));
  const target = await page.evaluate((title) => {
    const rowOf = (leaf) => {
      let el = leaf;
      for (let i = 0; i < 10 && el.parentElement; i += 1) {
        el = el.parentElement;
        const r = el.getBoundingClientRect();
        if (r.height > 20 && r.height < 110 && r.width > 300) return el;
      }
      return null;
    };
    const leaves = [...document.querySelectorAll('*')]
      .filter((e) => (e.textContent || '').includes(title) && (e.textContent || '').length < 90);
    leaves.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    const row = rowOf(leaves[0]);
    if (!row) return { err: 'row-not-found' };
    const buttons = [...row.querySelectorAll('button')].filter((b) => (b.offsetWidth || b.offsetHeight));
    const play = buttons.find((b) => (b.className || '').toString().includes('rounded-0'))
      || buttons.find((b) => !b.getAttribute('aria-label'))
      || buttons[0];
    if (!play) return { err: 'play-button-not-found' };
    const r = play.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), cls: (play.className || '').toString().slice(0, 36) };
  }, TITLE);
  if (target.err) {
    clickResult = target.err;
  } else {
    await page.mouse.click(target.x, target.y);
    clickResult = `mouse-click@${target.x},${target.y} ${target.cls}`;
  }
}

const ticks = [];
for (let i = 0; i < 4; i += 1) {
  await new Promise((r) => setTimeout(r, 3000));
  ticks.push(await queues());
}
let pathUsed = 'ui-click';
let after = await page.evaluate(() => ({ ...window.__lzcAudio }));

const playingNow = ticks.some((t) => t.some((q) => q.state === 'playing'));
if (!playingNow) {
  pathUsed = 'rpc-player_queues/play_media（UI 点击未起播）';
  await page.evaluate(async (uri) => {
    const tok = localStorage.getItem('ma_access_token') || '';
    const post = async (cmd, args) => (await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ message_id: 1, command: cmd, args }),
    })).text();
    let rows = [];
    try { rows = JSON.parse((await post('player_queues/all', {})) || '[]'); } catch { rows = []; }
    const q = rows.find((x) => x.available) || rows[0];
    await post('player_queues/play_media', { queue_id: q.queue_id, media: [uri], option: 'replace' });
  }, TRACK_URI);
  ticks.length = 0;
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    ticks.push(await queues());
  }
  after = await page.evaluate(() => ({ ...window.__lzcAudio }));
}

const flat = ticks.map((t) => (t[0] || {}));
const deltas = flat.slice(1).map((q, i) => +(q.elapsed - flat[i].elapsed).toFixed(2));
const monotonic = deltas.length >= 2 && deltas.every((d) => d > 2.5 && d < 3.6);
const buffers = after.buffers - before.buffers;
const samples = after.samples - before.samples;
const verdict = {
  ok: monotonic,
  path: pathUsed,
  click: clickResult,
  progressSamples: flat.map((q) => ({ state: q.state, current: q.current, elapsed: q.elapsed })),
  elapsedDeltas: deltas,
  monotonic,
  webAudio: { buffers, samples, secondsScheduled: +(samples / 44100).toFixed(2) },
  errors,
  shot: SHOT,
};
await page.screenshot({ path: SHOT });
console.log(JSON.stringify(verdict, null, 1));
await page.close();
await browser.disconnect();
process.exit(verdict.ok ? 0 : 2);
