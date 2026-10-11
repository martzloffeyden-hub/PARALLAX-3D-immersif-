// Parcours complet automatisé : verrouillages, portails, bascules de gravité, finale.
// Usage : node tests/playthrough.mjs [dossier_captures] [échelle_de_temps]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'tests/output';
const ts = Number(process.argv[3] || 3);
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = process.env.BASE || 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const state = () => page.evaluate(() => window.PARALLAX.debug.state());
const dbg = (fn, ...args) => page.evaluate(([f, a]) => window.PARALLAX.debug[f](...a), [fn, args]);
async function waitFor(pred, label, timeout = 600000) {
  const start = Date.now();
  for (;;) {
    const s = await state();
    if (pred(s)) return s;
    if (Date.now() - start > timeout) throw new Error(`Délai dépassé : ${label} — état ${JSON.stringify(s)}`);
    await page.waitForTimeout(400);
  }
}
async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  log('capture', name);
}
async function holdKey(code, ms) {
  await dbg('key', code, true);
  await page.waitForTimeout(ms);
  await dbg('key', code, false);
}

const results = [];
const step = async (name, fn) => {
  const s0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, s: (Date.now() - s0) / 1000 });
    log('OK  ', name);
  } catch (e) {
    results.push({ name, ok: false, err: String(e.message || e) });
    log('ÉCHEC', name, e.message);
    throw e;
  }
};

try {
  await page.goto(base + '?dev=threshold&fixed&quality=performance', { waitUntil: 'load' });
  await waitFor((s) => s.mode === 'play' && s.frames > 5, 'démarrage');
  await dbg('setTimeScale', ts);

  await step('I — verrouillage du cercle', async () => {
    await dbg('solve', 'cercle');
    await waitFor((s) => s.anam[0].state !== 'idle', 'début du verrouillage', 120000);
    await dbg('observe', false);
    await waitFor((s) => s.anam[0].state === 'locked', 'verrouillé', 120000);
  });
  await page.waitForTimeout(1500);
  await shot('01-lock');
  await step('I — séquence du Seuil (anneau → porte)', async () => {
    await waitFor((s) => !s.busy, 'fin de séquence', 600000);
  });
  await shot('02-portal-open');
  await step('I → II — traversée du portail', async () => {
    await dbg('walkTo', 0, -50);
    await page.evaluate(() => {
      const p = window.PARALLAX.player;
      p.yaw = 0;
      p.pitch = 0;
    });
    await holdKey('KeyW', 2500);
    await waitFor((s) => s.stage === 'archipelago', 'arrivée Archipel', 120000);
  });
  await page.waitForTimeout(800);
  await shot('03-archipelago-arrival');
  await step('II — verrouillage du pont', async () => {
    await dbg('solve', 'pont');
    await waitFor((s) => s.anam.find((a) => a.name === 'pont').state === 'locked', 'pont verrouillé', 120000);
    await dbg('observe', false);
  });
  await page.waitForTimeout(2500);
  await shot('04-bridge-assembling');
  await step('II — pont assemblé', async () => {
    await waitFor((s) => !s.busy, 'fin assemblage', 600000);
  });
  await shot('05-bridge-done');
  await step('II — bascule sur la paroi', async () => {
    await dbg('walkTo', 0, -66);
    await page.evaluate(() => {
      const p = window.PARALLAX.player;
      p.yaw = 0;
      p.pitch = 0;
    });
    await holdKey('KeyW', 2500);
    await waitFor((s) => s.frame === 'wall', 'référentiel paroi', 60000);
  });
  await page.waitForTimeout(2500);
  await shot('06-on-the-wall');
  await step('II — sommet', async () => {
    await page.evaluate(() => {
      const p = window.PARALLAX.player;
      p.teleport(p.frame, 0, 0.2, -45, 0, 0);
    });
    await holdKey('KeyW', 2500);
    await waitFor((s) => s.frame === 'main' && s.pos[1] > 45, 'sommet', 60000);
  });
  await page.waitForTimeout(2500);
  await shot('07-summit');
  await step('II — Porte de la Nuit', async () => {
    await dbg('solve', 'porte');
    await waitFor((s) => s.anam.find((a) => a.name === 'porte').state === 'locked', 'porte verrouillée', 120000);
    await dbg('observe', false);
    await page.waitForTimeout(4000);
    await shot('08-gate-assembling');
    await waitFor((s) => !s.busy, 'nuit tombée', 600000);
  });
  await shot('09-night');
  await step('II → III — traversée de la Porte', async () => {
    await page.evaluate(() => {
      const p = window.PARALLAX.player;
      p.teleport(p.frame, 0, 50.2, -112, 0, 0);
    });
    await holdKey('KeyW', 3000);
    await waitFor((s) => s.stage === 'vanishing', 'arrivée Point de fuite', 120000);
  });
  await page.waitForTimeout(800);
  await shot('10-vanishing-arrival');
  await step('III — marche vers le point de fuite', async () => {
    await page.evaluate(() => {
      const p = window.PARALLAX.player;
      p.teleport(p.frame, 0, 0.2, -60, 0, 0);
    });
    await holdKey('KeyW', 2500);
    await shot('11-causeway');
  });
  await step('III — convergence et finale', async () => {
    await dbg('solve', 'convergence');
    await waitFor((s) => s.anam[0].state === 'locked', 'convergence verrouillée', 120000);
    await dbg('observe', false);
    await page.waitForTimeout(5000);
    await shot('12-finale-dawn');
    await waitFor((s) => s.mode === 'credits', 'générique', 900000);
  });
  await page.waitForTimeout(3000);
  await shot('13-credits');
} catch (e) {
  await shot('zz-failure').catch(() => undefined);
} finally {
  const s = await state().catch(() => ({}));
  console.log('\n=== RÉSULTATS ===');
  for (const r of results) console.log(r.ok ? 'OK  ' : 'ÉCHEC', r.name, r.ok ? `(${r.s.toFixed(1)} s)` : r.err);
  console.log('Erreurs applicatives :', JSON.stringify(s.errors ?? []));
  console.log('Journal console (erreurs/avertissements) :');
  for (const l of logs.filter((l) => !l.includes('KHR_parallel_shader_compile')).slice(0, 40)) console.log('  ', l);
  await browser.close();
  process.exit(results.every((r) => r.ok) && results.length >= 12 ? 0 : 1);
}
