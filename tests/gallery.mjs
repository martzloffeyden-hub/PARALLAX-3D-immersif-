// Galerie de contrôle visuel : rend des vues fixes de chaque chapitre et relève le coût de rendu.
// Usage : node tests/gallery.mjs [dossier] [qualité] [filtre]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'tests/output/gallery';
const quality = process.argv[3] || 'high';
const filter = process.argv[4] || '';
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = process.env.BASE || 'http://localhost:4173/PARALLAX.html';
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 720);

// [nom, scène, x, y, z, lacet°, tangage°, script optionnel]
const VIEWS = [
  ['t1-title', 'title'],
  ['a1-spawn', 'threshold', 0, 0, 29, 0, 3],
  ['a1-piazza', 'threshold', -14, 0, 4, -30, 6],
  ['a1-viewpoint', 'threshold', 7.5, 1.5, 11, 24.4, 2.56],
  ['a1-gate', 'threshold', 10, 0, -20, 20, 10],
  ['a2-arrival', 'archipelago', 0, 0, 6.5, 0, 0],
  ['a2-terrace', 'archipelago', 9, 4, -8, 24, -10],
  ['a2-clouds', 'archipelago', -10, 0, 8, -130, -18],
  ['a2-islandB', 'archipelago', 6, 0, -48, -10, 14],
  ['a2-summit', 'archipelago', 0, 50, -74, 0, 2],
  ['a2-gateview', 'archipelago', 7.6, 50, -86, 10.8, 10],
  ['a3-start', 'vanishing', 0, 0, 12, 0, 2],
  ['a3-mid', 'vanishing', 0, 0, -50, 0, 3],
  ['a3-end', 'vanishing', 0, 0, -105, 0, 4],
  ['a3-back', 'vanishing', 0, 0, -100, 160, 2],
];

const browser = await chromium.launch({ executablePath: exe, args: [...(process.env.GPU ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
let current = '';
for (const v of VIEWS) {
  const [name, stage, x, y, z, yaw, pitch] = v;
  if (filter && !name.includes(filter)) continue;
  const q = stage === 'title' ? `dev=title&skipintro&fixed&nohud&quality=${quality}` : `dev=${stage}&fixed&nohud&quality=${quality}&cam=${x},${y},${z},${yaw},${pitch}`;
  if (current !== q) {
    await page.goto(`${base}?${q}`, { waitUntil: 'load' });
    current = q;
  }
  await page.waitForFunction(() => (window.PARALLAX?.frames ?? 0) > 6 && ['play', 'title'].includes(window.PARALLAX.debug.state().mode), null, { timeout: 240000, polling: 300 });
  await page.waitForTimeout(stage === 'title' ? 3000 : 800);
  const info = await page.evaluate(() => {
    const r = window.PARALLAX.graphics.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name.padEnd(14), `appels=${info.calls}`, `triangles=${(info.tris / 1000).toFixed(0)}k`, `géométries=${info.geos}`, `textures=${info.tex}`, `programmes=${info.progs}`);
}
console.log('erreurs :', errs.length ? errs : 'aucune');
await browser.close();
