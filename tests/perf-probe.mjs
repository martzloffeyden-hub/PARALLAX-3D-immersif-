// Coût de rendu relatif par chapitre et par profil (rendu logiciel SwiftShader :
// seules les proportions sont significatives, pas les valeurs absolues).
// Usage : node tests/perf-probe.mjs
import { chromium } from 'playwright-core';

const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = process.env.BASE || 'http://localhost:4173/PARALLAX.html';
const browser = await chromium.launch({ executablePath: exe, args: [...(process.env.GPU ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']), '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const VIEWS = [
  ['I   place', 'threshold', '0,0,20,0,3'],
  ['II  îles', 'archipelago', '9,4,-8,24,-10'],
  ['III chaussée', 'vanishing', '0,0,-50,0,3'],
];
const rows = [];
for (const q of ['high', 'balanced', 'performance']) {
  for (const [label, stage, cam] of VIEWS) {
    await page.goto(`${base}?dev=${stage}&nohud&quality=${q}&cam=${cam}`);
    await page.evaluate((qq) => { window.PARALLAX.settings.applyQuality(qq); window.PARALLAX.graphics.adaptive = false; window.PARALLAX.graphics.setBaseScale(1); }, q);
    await page.waitForFunction(() => (window.PARALLAX?.frames ?? 0) > 8, null, { timeout: 240000 });
    // Rendu synchrone forcé (lecture d'un pixel) : mesure le coût réel de l'image complète.
    const ms = await page.evaluate(() => {
      const app = window.PARALLAX;
      const g = app.graphics;
      const gl = g.renderer.getContext();
      const px = new Uint8Array(4);
      const times = [];
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        app.stage.preRender(g, app.director.camera);
        g.render(app.stage.scene, app.director.camera, app.time);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - t0);
      }
      return times.slice(2).sort((a, b) => a - b)[5];
    });
    const res = await page.evaluate(() => `${window.PARALLAX.graphics.width}×${window.PARALLAX.graphics.height}`);
    rows.push({ q, label, ms, res });
    console.log(q.padEnd(12), label.padEnd(14), res.padEnd(10), `${ms.toFixed(0)} ms/image (médiane, SwiftShader)`);
  }
}
await browser.close();
