import type { Settings, QualityProfile, SettingsData } from '../app/Settings';
import cg300 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-300-normal.woff2?url';
import cg300i from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-300-italic.woff2?url';
import cg500 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2?url';
import pm300 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-300-normal.woff2?url';
import pm400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import './styles.css';

export interface UIHandlers {
  enter(): void;
  start(): void;
  continueGame(): void;
  chapter(n: number): void;
  resume(): void;
  restartChapter(): void;
  mainMenu(): void;
  replay(): void;
  freeRoam(): void;
  hover(): void;
  click(): void;
}

const EMBLEM = `<svg class="emblem" viewBox="-60 -60 120 120" aria-hidden="true">
  <circle class="ring" r="48" transform="rotate(-90)"/>
  <line class="hz" x1="-60" y1="0" x2="60" y2="0"/>
</svg>`;

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** Charge les polices embarquées (sous-ensemble latin uniquement). */
export async function loadFonts(): Promise<void> {
  const faces: [string, string, string, string][] = [
    ['Cormorant', cg300, '300', 'normal'],
    ['Cormorant', cg300i, '300', 'italic'],
    ['Cormorant', cg500, '500', 'normal'],
    ['Plex Mono', pm300, '300', 'normal'],
    ['Plex Mono', pm400, '400', 'normal'],
  ];
  await Promise.all(
    faces.map(async ([family, url, weight, style]) => {
      try {
        const f = new FontFace(family, `url(${url})`, { weight, style, display: 'swap' });
        await f.load();
        document.fonts.add(f);
      } catch {
        /* police de secours */
      }
    }),
  );
}

export class UI {
  readonly root: HTMLElement;
  private loading!: HTMLElement;
  private gate!: HTMLElement;
  private title!: HTMLElement;
  private hud!: HTMLElement;
  private pause!: HTMLElement;
  private settingsPanel: HTMLElement | null = null;
  private controlsPanel: HTMLElement | null = null;
  private credits!: HTMLElement;
  private chapterEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private readoutEl!: HTMLElement;
  private reticle!: HTMLElement;
  private alignArc!: SVGCircleElement;
  private holdArc!: SVGCircleElement;
  private controlsCard!: HTMLElement;
  private fpsEl!: HTMLElement;
  private hintTimer = 0;
  private chapterTimer = 0;
  /** Libellés des touches selon la disposition du clavier (AZERTY / QWERTY). */
  keys = { fwd: 'W', left: 'A', back: 'S', right: 'D', layout: 'WASD' };
  private lastReadout = '';

  constructor(
    private settings: Settings,
    private h: UIHandlers,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    document.body.appendChild(this.root);
    this.build();
    this.detectLayout();
  }

  private async detectLayout(): Promise<void> {
    try {
      const kb = (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
      if (kb?.getLayoutMap) {
        const map = await kb.getLayoutMap();
        const f = (map.get('KeyW') || 'w').toUpperCase();
        const l = (map.get('KeyA') || 'a').toUpperCase();
        const b = (map.get('KeyS') || 's').toUpperCase();
        const r = (map.get('KeyD') || 'd').toUpperCase();
        this.keys = { fwd: f, left: l, back: b, right: r, layout: f + l + b + r };
      } else if ((navigator.language || '').toLowerCase().startsWith('fr')) {
        this.keys = { fwd: 'Z', left: 'Q', back: 'S', right: 'D', layout: 'ZQSD' };
      }
    } catch {
      /* ignore */
    }
    this.refreshKeyLabels();
  }

  private refreshKeyLabels(): void {
    this.root.querySelectorAll<HTMLElement>('[data-keys]').forEach((el) => (el.textContent = this.keys.layout));
    this.root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
      const k = el.dataset.key as keyof typeof this.keys;
      el.textContent = this.keys[k];
    });
  }

  private el(html: string): HTMLElement {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild as HTMLElement;
  }

  private button(btn: HTMLElement, fn: () => void): void {
    btn.addEventListener('mouseenter', () => this.h.hover());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.h.click();
      fn();
    });
  }

  private build(): void {
    const r = this.root;
    this.loading = this.el(`<div id="loading" class="layer fade on">
      ${EMBLEM}
      <div class="word">PARALLAX</div>
      <div class="bar"><i></i></div>
      <div class="status mono">Préparation</div>
    </div>`);
    this.gate = this.el(`<div id="gate" class="layer fade">
      <div class="pulse"></div>
      <div class="enter">Entrer</div>
      <div class="sub mono">Cliquer pour commencer · son activé · casque recommandé</div>
    </div>`);
    this.gate.addEventListener('click', () => this.h.enter());
    this.gate.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.h.enter();
    });

    this.title = this.el(`<div id="title" class="layer fade">
      <div class="top mono"><span>Une expérience en trois points de vue</span><span>N° 01 — MMXXVI</span></div>
      <div class="tagline">Le monde n’existe que sous un certain angle.</div>
      <nav class="menu"></nav>
      <div class="foot mono">Casque recommandé<br/>Plein écran — F11</div>
    </div>`);

    this.hud = this.el(`<div id="hud" class="layer fade">
      <svg id="reticle" viewBox="-32 -32 64 64">
        <circle class="track" r="15"/>
        <circle class="align" r="15" transform="rotate(-90)" stroke-dasharray="0 200"/>
        <circle class="hold" r="20" transform="rotate(-90)" stroke-dasharray="0 200"/>
        <circle class="dot" r="1.6"/>
      </svg>
      <div id="readout" class="mono"></div>
      <div id="hint"></div>
      <div id="controls-card" class="mono fade">
        <div><span class="k" data-keys>WASD</span>se déplacer</div>
        <div><span class="k">Souris</span>regarder</div>
        <div><span class="k">Clic maintenu</span>observer</div>
        <div><span class="k">Maj</span>courir</div>
        <div><span class="k">Échap</span>pause</div>
      </div>
      <div id="chapter"><div class="num mono"></div><div class="name"></div><div class="line"></div><div class="sub"></div></div>
      <div id="fps" class="mono"></div>
    </div>`);

    this.pause = this.el(`<div id="pause" class="layer fade">
      <div class="veil"></div>
      <nav class="menu">
        <div class="label mono">Pause</div>
        <button class="item" data-a="resume">Reprendre</button>
        <button class="item" data-a="settings">Paramètres</button>
        <button class="item" data-a="controls">Commandes</button>
        <button class="item" data-a="restart">Recommencer le chapitre</button>
        <button class="item" data-a="menu">Menu principal</button>
      </nav>
      <div class="status mono"></div>
    </div>`);
    this.pause.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => {
      const a = b.dataset.a;
      this.button(b, () => {
        if (a === 'resume') this.h.resume();
        else if (a === 'settings') this.openSettings();
        else if (a === 'controls') this.openControls();
        else if (a === 'restart') this.h.restartChapter();
        else if (a === 'menu') this.h.mainMenu();
      });
    });

    this.credits = this.el(`<div id="credits" class="layer fade">
      <div class="t">PARALLAX</div>
      <div class="s">Vous avez trouvé le point de vue. Le monde est entier.</div>
      <div class="roll mono">
        <div><b>Conception, direction artistique, code, image et son</b></div>
        <div>Claude — Anthropic</div>
        <div style="margin-top:14px">Three.js · Web Audio API · polices Cormorant Garamond & IBM Plex Mono (SIL OFL)</div>
        <div>Aucune ressource externe — tout est généré en temps réel</div>
      </div>
      <nav class="menu">
        <button class="item" data-a="free">Exploration libre</button>
        <button class="item" data-a="replay">Rejouer</button>
        <button class="item" data-a="menu">Menu principal</button>
      </nav>
    </div>`);
    this.credits.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => {
      const a = b.dataset.a;
      this.button(b, () => {
        if (a === 'free') this.h.freeRoam();
        else if (a === 'replay') this.h.replay();
        else this.h.mainMenu();
      });
    });

    r.append(this.loading, this.gate, this.title, this.hud, this.pause, this.credits);
    this.chapterEl = $(this.hud, '#chapter');
    this.hintEl = $(this.hud, '#hint');
    this.readoutEl = $(this.hud, '#readout');
    this.reticle = $(this.hud, '#reticle');
    this.alignArc = this.reticle.querySelector('.align') as SVGCircleElement;
    this.holdArc = this.reticle.querySelector('.hold') as SVGCircleElement;
    this.controlsCard = $(this.hud, '#controls-card');
    this.fpsEl = $(this.hud, '#fps');
  }

  // ------------------------------------------------------------ Chargement
  setLoading(progress: number, status: string): void {
    ($(this.loading, '.bar i') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    $(this.loading, '.status').textContent = status;
  }

  hideLoading(): void {
    this.loading.classList.remove('on');
  }

  showGate(on: boolean): void {
    this.gate.classList.toggle('on', on);
    if (on) {
      this.gate.tabIndex = 0;
      this.gate.focus();
    }
  }

  // ------------------------------------------------------------ Titre
  showTitle(on: boolean, opts: { reached: number; completed: boolean } = { reached: 0, completed: false }): void {
    if (on) {
      const menu = $(this.title, '.menu');
      menu.innerHTML = '';
      const roman = ['', 'I', 'II', 'III'];
      const add = (label: string, fn: () => void, meta = '') => {
        const b = this.el(`<button class="item">${label}${meta ? `<span class="meta">${meta}</span>` : ''}</button>`);
        this.button(b, fn);
        menu.appendChild(b);
      };
      if (opts.reached > 1 && !opts.completed) {
        add('Continuer', () => this.h.continueGame(), `Chapitre ${roman[opts.reached]}`);
        add('Nouvelle partie', () => this.h.start());
      } else {
        add(opts.completed ? 'Rejouer' : 'Commencer', () => this.h.start());
      }
      if (opts.reached > 1 || opts.completed) {
        const max = opts.completed ? 3 : opts.reached;
        for (let i = 2; i <= max; i++) add(`Chapitre ${roman[i]}`, () => this.h.chapter(i), i === 2 ? 'L’Archipel' : 'Le Point de fuite');
      }
      add('Paramètres', () => this.openSettings());
      add('Commandes', () => this.openControls());
    }
    this.title.classList.toggle('on', on);
  }

  // ------------------------------------------------------------ HUD
  showHUD(on: boolean): void {
    this.hud.classList.toggle('on', on);
  }

  showControlsCard(on: boolean): void {
    this.controlsCard.classList.toggle('on', on);
  }

  /**
   * Réticule d'alignement : arc = alignement, arc vermillon = maintien en cours.
   */
  setAlignment(a: number, canLock: boolean, hold: number, visible: boolean, observing: boolean): void {
    const c = 2 * Math.PI * 15;
    const c2 = 2 * Math.PI * 20;
    this.alignArc.setAttribute('stroke-dasharray', `${(a * c).toFixed(1)} 200`);
    this.holdArc.setAttribute('stroke-dasharray', `${(hold * c2).toFixed(1)} 200`);
    this.reticle.classList.toggle('ready', canLock);
    this.reticle.style.opacity = visible ? '1' : '0.55';
    let text = '';
    if (visible && a > 0.04) {
      text = `<div>Alignement ${a.toFixed(2)}</div>`;
      if (canLock) text += `<div class="prompt">${observing ? 'Fixez le regard…' : 'Maintenir <span class="key">clic</span> pour observer'}</div>`;
    }
    if (text !== this.lastReadout) {
      this.readoutEl.innerHTML = text;
      this.lastReadout = text;
    }
  }

  hint(html: string, duration = 7): void {
    window.clearTimeout(this.hintTimer);
    this.hintEl.innerHTML = html
      .replace(/\{keys\}/g, `<span class="k">${this.keys.layout}</span>`)
      .replace(/\{(clic|Espace|Maj|Échap|E)\}/g, '<span class="k">$1</span>');
    this.hintEl.classList.add('on');
    if (duration > 0) this.hintTimer = window.setTimeout(() => this.hintEl.classList.remove('on'), duration * 1000);
  }

  clearHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hintEl.classList.remove('on');
  }

  chapterCard(num: string, name: string, sub: string, duration = 6.5): void {
    window.clearTimeout(this.chapterTimer);
    $(this.chapterEl, '.num').textContent = num;
    $(this.chapterEl, '.name').textContent = name;
    $(this.chapterEl, '.sub').textContent = sub;
    this.chapterEl.classList.add('on');
    this.chapterTimer = window.setTimeout(() => this.chapterEl.classList.remove('on'), duration * 1000);
  }

  setFps(on: boolean, text: string): void {
    this.fpsEl.classList.toggle('on', on);
    if (on) this.fpsEl.innerHTML = text;
  }

  // ------------------------------------------------------------ Pause
  showPause(on: boolean, status = ''): void {
    if (on) $(this.pause, '.status').innerHTML = status;
    else this.closePanels();
    this.pause.classList.toggle('on', on);
  }

  get panelOpen(): boolean {
    return !!(this.settingsPanel || this.controlsPanel);
  }

  closePanels(): void {
    this.settingsPanel?.remove();
    this.settingsPanel = null;
    this.controlsPanel?.remove();
    this.controlsPanel = null;
  }

  // ------------------------------------------------------------ Générique
  showCredits(on: boolean): void {
    this.credits.classList.toggle('on', on);
  }

  // ------------------------------------------------------------ Erreur
  showError(title: string, message: string, detail = ''): void {
    const e = this.el(`<div id="error" class="layer fade on">
      ${EMBLEM.replace('class="emblem"', 'class="emblem" style="width:84px;height:84px"')}
      <h1></h1><p></p><div class="mono"></div>
      <button class="item">Recharger</button>
    </div>`);
    $(e, 'h1').textContent = title;
    $(e, 'p').textContent = message;
    $(e, '.mono').textContent = detail;
    $(e, 'button').addEventListener('click', () => location.reload());
    this.root.appendChild(e);
  }

  // ------------------------------------------------------------ Paramètres
  openSettings(): void {
    this.closePanels();
    const s = this.settings;
    const p = this.el(`<div class="panel" role="dialog" aria-label="Paramètres">
      <button class="close mono">Fermer ✕</button>
      <h2>Paramètres</h2>
      <div class="tabs">
        <button class="tab mono on" data-t="g">Graphismes</button>
        <button class="tab mono" data-t="c">Commandes</button>
        <button class="tab mono" data-t="a">Audio</button>
        <button class="tab mono" data-t="x">Confort</button>
      </div>
      <div class="body"></div>
    </div>`);
    this.button($(p, '.close'), () => this.closePanels());
    const body = $(p, '.body');
    const tabs = p.querySelectorAll<HTMLElement>('.tab');
    const render = (t: string) => {
      tabs.forEach((x) => x.classList.toggle('on', x.dataset.t === t));
      body.innerHTML = '';
      const d = s.data;
      if (t === 'g') {
        body.append(
          this.segRow('Qualité graphique', 'Profils adaptés : « Équilibrée » est recommandée pour un GPU intégré (Intel Iris Xe).', [
            ['high', 'Élevée'],
            ['balanced', 'Équilibrée'],
            ['performance', 'Performances'],
          ], d.quality, (v) => {
            s.applyQuality(v as QualityProfile);
            render('g');
          }),
          this.toggleRow('Résolution adaptative', 'Ajuste la résolution interne pour tenir la fréquence cible.', d.adaptiveResolution, (v) => s.set('adaptiveResolution', v)),
          this.sliderRow('Résolution interne', 'Échelle de base du rendu 3D.', d.renderScale, 0.5, 1, 0.05, (v) => `${Math.round(v * 100)} %`, (v) => s.set('renderScale', v)),
          this.segRow('Fréquence cible', '30 i/s laisse plus de marge à la résolution sur les machines modestes.', [
            ['60', '60 i/s'],
            ['30', '30 i/s'],
          ], String(d.targetFps), (v) => s.set('targetFps', v === '30' ? 30 : 60)),
          this.toggleRow('Afficher les performances', 'Images par seconde, résolution, appels de dessin.', d.showFps, (v) => s.set('showFps', v)),
        );
      } else if (t === 'c') {
        body.append(
          this.sliderRow('Sensibilité de la souris', '', d.sensitivity, 0.2, 3, 0.05, (v) => v.toFixed(2), (v) => s.set('sensitivity', v)),
          this.toggleRow('Inverser l’axe vertical', '', d.invertY, (v) => s.set('invertY', v)),
          this.sliderRow('Champ de vision', 'Angle vertical en degrés.', d.fov, 55, 95, 1, (v) => `${Math.round(v)}°`, (v) => s.set('fov', v)),
        );
      } else if (t === 'a') {
        body.append(
          this.sliderRow('Volume général', '', d.volMaster, 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, (v) => s.set('volMaster', v)),
          this.sliderRow('Musique', '', d.volMusic, 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, (v) => s.set('volMusic', v)),
          this.sliderRow('Effets et ambiances', '', d.volSfx, 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, (v) => s.set('volSfx', v)),
        );
      } else {
        body.append(
          this.toggleRow('Balancement de la tête', 'Mouvement naturel de la caméra pendant la marche.', d.headBob, (v) => s.set('headBob', v)),
          this.toggleRow('Mouvements réduits', 'Atténue secousses, roulis et variations de focale.', d.reducedMotion, (v) => s.set('reducedMotion', v)),
          this.toggleRow('Indices', 'Suggestions discrètes lorsque vous semblez chercher.', d.hints, (v) => s.set('hints', v)),
        );
      }
    };
    tabs.forEach((tb) => this.button(tb, () => render(tb.dataset.t!)));
    render('g');
    this.root.appendChild(p);
    this.settingsPanel = p;
  }

  openControls(): void {
    this.closePanels();
    const k = this.keys;
    const p = this.el(`<div class="panel" role="dialog" aria-label="Commandes">
      <button class="close mono">Fermer ✕</button>
      <h2>Commandes</h2>
      <div class="keys">
        <div class="k"><span>${k.fwd}</span><span>${k.left}</span><span>${k.back}</span><span>${k.right}</span><span>Flèches</span></div><div class="d">Se déplacer</div>
        <div class="k"><span>Souris</span></div><div class="d">Regarder (cliquer dans l’image pour capturer le pointeur)</div>
        <div class="k"><span>Clic maintenu</span><span>Espace</span><span>E</span></div><div class="d"><em>Observer</em> : le pas ralentit, le regard se concentre. Au bon endroit, le regard <em>se fixe</em> et le monde se transforme.</div>
        <div class="k"><span>Maj</span></div><div class="d">Courir</div>
        <div class="k"><span>Échap</span></div><div class="d">Pause, paramètres</div>
        <div class="k"><span>F11</span></div><div class="d">Plein écran (recommandé)</div>
        <div class="k"><span>Manette</span></div><div class="d">Stick gauche : marcher · stick droit : regarder · A ou gâchette : observer · Start : pause</div>
      </div>
      <div class="note mono">Le principe : chaque figure vermillon ne se recompose que depuis un point de vue unique. Approchez-vous, écoutez — l’accord devient pur quand vous êtes au bon endroit.</div>
    </div>`);
    this.button($(p, '.close'), () => this.closePanels());
    this.root.appendChild(p);
    this.controlsPanel = p;
  }

  private segRow(label: string, desc: string, opts: [string, string][], value: string, on: (v: string) => void): HTMLElement {
    const row = this.el(`<div class="row"><div class="lbl">${label}${desc ? `<span class="desc">${desc}</span>` : ''}</div><div class="seg"></div></div>`);
    const seg = $(row, '.seg');
    for (const [v, l] of opts) {
      const b = this.el(`<button class="${v === value ? 'on' : ''}">${l}</button>`);
      this.button(b, () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        on(v);
      });
      seg.appendChild(b);
    }
    return row;
  }

  private toggleRow(label: string, desc: string, value: boolean, on: (v: boolean) => void): HTMLElement {
    const row = this.el(`<div class="row"><div class="lbl">${label}${desc ? `<span class="desc">${desc}</span>` : ''}</div><button class="toggle ${value ? 'on' : ''}" aria-pressed="${value}"></button></div>`);
    const t = $(row, '.toggle');
    this.button(t, () => {
      const v = !t.classList.contains('on');
      t.classList.toggle('on', v);
      t.setAttribute('aria-pressed', String(v));
      on(v);
    });
    return row;
  }

  private sliderRow(label: string, desc: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, on: (v: number) => void): HTMLElement {
    const row = this.el(`<div class="row"><div class="lbl">${label}${desc ? `<span class="desc">${desc}</span>` : ''}</div><div class="slider"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"/><span class="v mono"></span></div></div>`);
    const input = $(row, 'input') as HTMLInputElement;
    const v = $(row, '.v');
    v.textContent = fmt(value);
    input.addEventListener('input', () => {
      const x = Number(input.value);
      v.textContent = fmt(x);
      on(x);
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    return row;
  }
}

export type { SettingsData };
