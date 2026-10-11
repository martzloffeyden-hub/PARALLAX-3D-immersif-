// Captures successives du finale (chapitre III) pour contrôler le cadrage et la lumière.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'tests/output/finale';
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = process.env.BASE || 'http://localhost:4173/PARALLAX.html';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?dev=vanishing&fixed&nohud&quality=${process.env.Q || 'balanced'}&cam=0,0,-100,0,2`);
await page.waitForFunction(() => window.PARALLAX?.debug?.state().mode === 'play', null, { timeout: 240000 });
// Sans audio, l'horloge du finale suit le temps de jeu : on accélère pour que le rendu logiciel suive.
await page.evaluate(() => window.PARALLAX.debug.setTimeScale(2));
await page.evaluate(() => window.PARALLAX.debug.solve('convergence'));
let i = 0;
for (;;) {
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => window.PARALLAX.debug.state());
  await page.screenshot({ path: `${out}/f${String(i).padStart(2, '0')}.png` });
  console.log('f' + i, s.mode, s.anam[0].state);
  i++;
  if (s.mode === 'credits') {
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${out}/f${String(i).padStart(2, '0')}-credits.png` });
    break;
  }
  if (i > 60) break;
}
await browser.close();
