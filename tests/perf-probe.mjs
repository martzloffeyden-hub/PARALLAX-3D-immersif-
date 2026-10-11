// Coût de rendu relatif par chapitre et par profil (rendu logiciel SwiftShader :
// seules les proportions sont significatives, pas les valeurs absolues).
// Usage : node tests/perf-probe.mjs
import { chromium } from 'playwright-core';

const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = process.env.BASE || 'http://localhost:4173/PARALLAX.html';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const VIEWS = [
  ['I   place', 'threshold', '0,0,20,0,3'],
  ['II  îles', 'archipelago', '9,4,-8,24,-10'],
  ['III chaussée', 'vanishing', '0,0,-50,0,3'],
];
const rows = [];
for (const q of ['high', 'balanced', 'performance']) {
  for (const [label, stage, cam] of VIEWS) {
    await page.goto(`${base}?dev=${stage}&fixed&nohud&quality=${q}&cam=${cam}`);
    await page.waitForFunction(() => (window.PARALLAX?.frames ?? 0) > 8, null, { timeout: 240000 });
    const ms = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const t = [];
          let last = performance.now();
          const tick = (now) => {
            t.push(now - last);
            last = now;
            if (t.length < 25) requestAnimationFrame(tick);
            else resolve(t.slice(5).sort((a, b) => a - b)[10]);
          };
          requestAnimationFrame(tick);
        }),
    );
    const res = await page.evaluate(() => `${window.PARALLAX.graphics.width}×${window.PARALLAX.graphics.height}`);
    rows.push({ q, label, ms, res });
    console.log(q.padEnd(12), label.padEnd(14), res.padEnd(10), `${ms.toFixed(0)} ms/image (médiane, SwiftShader)`);
  }
}
await browser.close();
