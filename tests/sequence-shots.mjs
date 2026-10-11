// Captures successives d'une séquence de verrouillage : node tests/sequence-shots.mjs <scène> <figure> <dossier> [intervalle_ms]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [, , stage = 'threshold', anam = 'cercle', out = 'tests/output/seq', every = '2000'] = process.argv;
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = process.env.BASE || 'http://localhost:4173/PARALLAX.html';
const browser = await chromium.launch({ executablePath: exe, args: [...(process.env.GPU ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?dev=${stage}&fixed&nohud&quality=${process.env.Q || 'balanced'}`);
await page.waitForFunction(() => window.PARALLAX?.debug?.state().mode === 'play', null, { timeout: 240000 });
if (process.env.PRE) await page.evaluate(process.env.PRE);
await page.evaluate(() => window.PARALLAX.debug.setTimeScale(Number(new URLSearchParams(location.search).get('ts') || 1.5)));
await page.evaluate((n) => window.PARALLAX.debug.solve(n), anam);
let i = 0;
let seenBusy = false;
for (;;) {
  await page.waitForTimeout(+every);
  const s = await page.evaluate(() => window.PARALLAX.debug.state());
  if (s.anam.find((a) => a.name === anam)?.state === 'locked') await page.evaluate(() => window.PARALLAX.debug.observe(false));
  await page.screenshot({ path: `${out}/s${String(i).padStart(2, '0')}.png` });
  console.log('s' + i, s.mode, s.busy ? 'séquence' : '-', s.frame);
  i++;
  if (s.busy) seenBusy = true;
  if ((seenBusy && !s.busy) || i > 40) break;
}
await browser.close();
