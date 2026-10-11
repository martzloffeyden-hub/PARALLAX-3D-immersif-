// Contrôle du mixage audio : niveaux RMS / crête pendant les moments clés.
// Usage : node tests/audio-mix.mjs
import { chromium } from 'playwright-core';

const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = process.env.BASE || 'http://localhost:4173/PARALLAX.html';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const ev = (code) => page.evaluate(code);

async function measure(label, seconds) {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let nan = false;
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const l = await ev('window.PARALLAX.debug.audioLevels()');
    peak = Math.max(peak, l.peak);
    sum += l.rms;
    n++;
    nan ||= l.nan;
    await page.waitForTimeout(120);
  }
  const rms = sum / Math.max(1, n);
  const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
  const flag = nan ? 'NaN !' : peak > 0.97 ? 'ÉCRÊTAGE ?' : rms < 0.003 ? 'TRÈS FAIBLE' : 'ok';
  console.log(`${label.padEnd(34)} RMS ${db(rms).padStart(6)} dBFS   crête ${db(peak).padStart(6)} dBFS   ${flag}`);
  return { rms, peak, nan };
}

await page.goto(`${base}?dev=threshold&fixed&quality=performance`);
await page.waitForFunction(() => window.PARALLAX?.debug?.state().mode === 'play', null, { timeout: 180000 });
await ev(`(async () => { await window.PARALLAX.audio.init(); window.PARALLAX.audio.setVolumes(0.8, 0.75, 0.85); })()`);
await ev(`window.PARALLAX.audio.setScene('title')`);
await measure('Titre (musique + ambiance)', 8);
await ev(`window.PARALLAX.audio.setScene('threshold'); window.PARALLAX.stages.threshold.begin();`);
await measure('Chap. I — ambiance au départ', 6);
await ev(`window.PARALLAX.debug.teleport(7.5, 1.5, 15, 24, 2)`);
await measure('Chap. I — près du point de vue', 4);
await ev(`window.PARALLAX.debug.solve('cercle')`);
await measure('Chap. I — verrouillage + séquence', 14);
await ev(`window.PARALLAX.debug.observe(false)`);
await measure('Chap. I — suite de la séquence', 10);
await ev(`window.PARALLAX.audio.setScene('archipelago')`);
await measure('Chap. II — ambiance', 6);
await ev(`window.PARALLAX.audio.setScene('vanishing'); window.PARALLAX.audio.music.setIntensity(0.9);`);
await measure('Chap. III — intensité 0.9 (pulsation)', 8);
await ev(`window.PARALLAX.audio.music.playFinale(0.1)`);
await measure('Finale — montée (0-20 s)', 20);
await measure('Finale — sommet et coda', 14);
console.log('Crête maximale observée :', (await ev('window.PARALLAX.audio.peakSeen')).toFixed(3));
console.log('Erreurs :', errs.length ? errs : 'aucune');
await browser.close();
