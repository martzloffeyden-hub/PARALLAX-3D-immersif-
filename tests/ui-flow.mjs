// Parcours de l'interface avec de vrais clics : chargement, porte d'entrée (activation du son),
// titre, paramètres, commandes, lancement, carton de chapitre, pause, reprise.
// Usage : node tests/ui-flow.mjs [dossier_captures]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'tests/output/ui';
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = process.env.URL || 'http://localhost:4173/PARALLAX.html';
const browser = await chromium.launch({ executablePath: exe, args: [...(process.env.GPU ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  log(ok ? 'OK  ' : 'ÉCHEC', name, info);
};
const state = () => page.evaluate(() => window.PARALLAX?.debug?.state?.() ?? null);
const waitState = async (pred, timeout = 300000) => {
  const s0 = Date.now();
  for (;;) {
    const s = await state().catch(() => null);
    if (s && pred(s)) return s;
    if (Date.now() - s0 > timeout) return null;
    await page.waitForTimeout(300);
  }
};

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#loading', { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/01-loading.png` });
  check('écran de chargement affiché', await page.isVisible('#loading'));

  const gate = await waitState((s) => s.mode === 'gate');
  check('chargement terminé → porte d’entrée', !!gate);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/02-gate.png` });

  await page.click('#gate');
  const title = await waitState((s) => s.mode === 'title');
  check('clic sur « Entrer » → titre', !!title);
  await page.waitForTimeout(400);
  const audioOk = await page.evaluate(() => window.PARALLAX.audio.ready);
  check('audio initialisé après le geste utilisateur', audioOk);
  await page.waitForSelector('#title.on', { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/03-title.png` });
  let peak = 0;
  for (let i = 0; i < 10; i++) {
    const l = await page.evaluate(() => window.PARALLAX.debug.audioLevels());
    peak = Math.max(peak, l.peak);
    if (l.nan) check('signal audio valide (pas de NaN)', false);
    await page.waitForTimeout(300);
  }
  check('musique du titre audible', peak > 0.002, `crête ${peak.toFixed(4)}`);
  check('pas d’écrêtage', peak < 1.0, `crête ${peak.toFixed(4)}`);

  // Paramètres
  await page.click('#title .menu .item:has-text("Paramètres")');
  await page.waitForSelector('.panel', { timeout: 5000 });
  await page.screenshot({ path: `${out}/04-settings.png` });
  await page.click('.panel .tab:has-text("Audio")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/05-settings-audio.png` });
  await page.click('.panel .tab:has-text("Graphismes")');
  await page.click('.panel .seg button:has-text("Performances")');
  await page.waitForTimeout(500);
  const prof = await page.evaluate(() => window.PARALLAX.graphics.profile);
  check('changement de profil graphique appliqué', prof === 'performance', prof);
  await page.click('.panel .seg button:has-text("Équilibrée")');
  await page.click('.panel .close');
  check('panneau fermé', !(await page.isVisible('.panel')));

  await page.click('#title .menu .item:has-text("Commandes")');
  await page.waitForSelector('.panel', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/06-controls.png` });
  await page.click('.panel .close');

  // Lancement
  await page.click('#title .menu .item:has-text("Commencer"), #title .menu .item:has-text("Rejouer"), #title .menu .item:has-text("Nouvelle partie")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/07-dive.png` });
  const playing = await waitState((s) => s.stage === 'threshold' && (s.mode === 'play' || s.mode === 'paused'), 300000);
  check('« Commencer » → chapitre I', !!playing, playing?.mode);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/08-chapter-card.png` });
  const s1 = await state();
  if (s1.mode === 'paused') {
    // Le navigateur sans écran peut refuser le verrouillage du pointeur : le jeu propose alors « Reprendre ».
    await page.screenshot({ path: `${out}/09-pause.png` });
    check('menu de pause proposé si le pointeur n’est pas capturé', await page.isVisible('#pause.on'));
    await page.click('#pause .item:has-text("Reprendre")');
  } else {
    await page.evaluate(() => window.PARALLAX.debug.pause());
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/09-pause.png` });
    check('menu de pause', await page.isVisible('#pause.on'));
    await page.click('#pause .item:has-text("Reprendre")');
  }
  await page.waitForTimeout(800);
  const s2 = await state();
  check('reprise après la pause', s2.mode === 'play' || s2.mode === 'paused', s2.mode);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/10-act1-start.png` });
  let peak2 = 0;
  for (let i = 0; i < 8; i++) {
    const l = await page.evaluate(() => window.PARALLAX.debug.audioLevels());
    peak2 = Math.max(peak2, l.peak);
    await page.waitForTimeout(300);
  }
  check('ambiance sonore du chapitre I audible', peak2 > 0.002, `crête ${peak2.toFixed(4)}`);
  const st = await state();
  check('aucune erreur applicative', st.errors.length === 0, JSON.stringify(st.errors));
} catch (e) {
  check('exception du test', false, String(e.message || e));
  await page.screenshot({ path: `${out}/zz-failure.png` }).catch(() => undefined);
} finally {
  console.log('\n=== RÉSULTATS ===');
  for (const r of results) console.log(r.ok ? 'OK  ' : 'ÉCHEC', r.name, r.info);
  const filtered = logs.filter((l) => !l.includes('KHR_parallel_shader_compile'));
  console.log('Console :', filtered.length ? '' : 'aucun avertissement');
  for (const l of filtered.slice(0, 30)) console.log('  ', l);
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
