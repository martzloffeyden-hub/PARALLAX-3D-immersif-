// Capture d'écran d'une URL du serveur de dev : node tests/shot.mjs "<query>" out.png [frames] [w] [h]
import { chromium } from 'playwright-core';
const [, , query = '', out = 'shot.png', frames = '30', w = '1280', h = '720'] = process.argv;
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const base = process.env.BASE || 'http://localhost:5173/';
await page.goto(base + (query ? '?' + query : ''), { waitUntil: 'load' });
const t0 = Date.now();
await page.waitForFunction((n) => (window.PARALLAX?.frames ?? 0) >= n, +frames, { timeout: 240000, polling: 200 });
if (process.env.EVAL) {
  await page.evaluate(process.env.EVAL);
  const f0 = await page.evaluate(() => window.PARALLAX.frames);
  await page.waitForFunction((n) => window.PARALLAX.frames >= n, f0 + 4, { timeout: 120000, polling: 100 });
}
const fps = await page.evaluate(() => window.PARALLAX.frames);
await page.screenshot({ path: out });
console.log(`ok ${out} frames=${fps} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const l of logs.slice(0, 30)) console.log(l);
await browser.close();
