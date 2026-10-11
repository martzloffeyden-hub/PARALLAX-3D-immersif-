import * as THREE from 'three';
import { Graphics } from '../render/Graphics';
import { createProceduralTextures, type ProceduralTextureSet } from '../render/ProceduralTextures';
import { detectQuality } from '../render/Quality';
import { lerpGrade } from '../render/PostFX';
import { surfaceDetail, globalUniforms } from '../render/Surface';
import { Settings, Progress, type ProgressData } from './Settings';
import { Director, makePose, type CamPose } from './Director';
import { Player } from '../player/Player';
import { Input } from '../player/Input';
import { AudioEngine } from '../audio/AudioEngine';
import type { Stage, StageContext, StageHost } from '../stages/Stage';
import { TitleStage } from '../stages/TitleStage';
import { ThresholdStage } from '../stages/ThresholdStage';
import { ArchipelagoStage } from '../stages/ArchipelagoStage';
import { VanishingStage } from '../stages/VanishingStage';
import type { Anamorphosis } from '../world/Anamorphosis';
import { UI, loadFonts } from '../ui/UI';
import { clamp, damp } from '../util/math';
import { Sequence } from '../util/Sequence';

type Mode = 'loading' | 'gate' | 'title' | 'transition' | 'play' | 'paused' | 'credits' | 'error';

const STAGE_ORDER = ['threshold', 'archipelago', 'vanishing'];

interface Fade {
  from: number;
  to: number;
  dur: number;
  t: number;
  then?: () => void;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class App {
  graphics!: Graphics;
  settings!: Settings;
  textures!: ProceduralTextureSet;
  director!: Director;
  player!: Player;
  input!: Input;
  ui!: UI;
  readonly audio = new AudioEngine();
  stages: Record<string, Stage> = {};
  stage!: Stage;
  title!: TitleStage;
  mode: Mode = 'loading';
  progress: ProgressData = Progress.load();
  private ctx!: StageContext;
  private last = 0;
  /** Temps de jeu (s'arrête en pause). */
  time = 0;
  private playerPose = makePose();
  private titlePose = makePose();
  private params = new URLSearchParams(location.search);
  private fade: Fade | null = null;
  private lockHold = 0;
  private paintedPaused = false;
  private fpsAcc = { t: 0, n: 0, text: '' };
  private freeRoam = false;
  private host!: StageHost;
  private ending = false;
  /** Échelle de temps (tests automatisés uniquement). */
  timeScale = 1;
  /** Observation forcée (tests automatisés uniquement). */
  private forceObserve = false;
  frames = 0;
  errors: string[] = [];

  constructor(private root: HTMLElement) {}

  // ================================================================ Démarrage
  async start(): Promise<void> {
    window.addEventListener('error', (e) => this.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(String(e.reason)));
    const probe = document.createElement('canvas').getContext('webgl2');
    const det = detectQuality(probe);
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    this.settings = new Settings(det.profile);
    this.ui = new UI(this.settings, {
      enter: () => this.onEnter(),
      start: () => this.startChapter(1, true),
      continueGame: () => this.startChapter(Math.max(1, this.progress.reached), false),
      chapter: (n) => this.startChapter(n, false),
      resume: () => this.resume(),
      restartChapter: () => this.restartChapter(),
      mainMenu: () => this.toTitle(),
      replay: () => this.startChapter(1, true),
      freeRoam: () => this.startFreeRoam(),
      hover: () => this.audio.uiHover(),
      click: () => this.audio.uiClick(),
    });
    if (!probe) {
      this.mode = 'error';
      this.ui.hideLoading();
      this.ui.showError(
        'WebGL 2 indisponible',
        'PARALLAX a besoin de l’accélération graphique de votre navigateur.',
        'Dans Chrome : Paramètres → Système → activer « Utiliser l’accélération graphique si disponible », puis relancer le navigateur. Vérifiez aussi que les pilotes graphiques Intel sont à jour.',
      );
      return;
    }
    try {
      this.ui.setLoading(0.03, 'Typographie');
      await Promise.race([loadFonts(), new Promise((r) => setTimeout(r, 2500))]);
      await nextFrame();
      const q = this.settings.data.quality;
      this.graphics = new Graphics(this.root, q, det.gpu);
      this.applySettings();
      this.graphics.onContextLost = () => this.onContextLost();
      this.ui.setLoading(0.08, 'Matières');
      await nextFrame();
      this.textures = createProceduralTextures(this.graphics.renderer);
      this.director = new Director(this.graphics.aspect);
      this.input = new Input(this.graphics.canvas);
      this.ctx = { graphics: this.graphics, textures: this.textures, quality: this.graphics.preset, audio: this.audio, stage: (id: string) => this.stages[id] };
      this.host = this.makeHost();

      const builders: [string, () => Stage][] = [
        ['title', () => new TitleStage()],
        ['threshold', () => new ThresholdStage()],
        ['archipelago', () => new ArchipelagoStage()],
        ['vanishing', () => new VanishingStage()],
      ];
      let i = 0;
      for (const [id, make] of builders) {
        this.ui.setLoading(0.12 + (0.55 * i) / builders.length, `Construction — ${stageLabel(id)}`);
        await nextFrame();
        const st = make();
        st.build(this.ctx);
        this.stages[id] = st;
        i++;
      }
      this.title = this.stages.title as TitleStage;
      this.player = new Player(this.stages.threshold.mainFrame);
      this.player.onFootstep = (s, k) => this.audio.footstep(s, k);
      this.player.onLand = (_s, k) => this.audio.land(k);
      this.player.onFall = () => this.onFall();

      // Compilation des shaders (évite les saccades à l'entrée de chaque scène).
      i = 0;
      for (const st of Object.values(this.stages)) {
        this.ui.setLoading(0.68 + (0.3 * i) / Object.keys(this.stages).length, `Compilation des shaders — ${stageLabel(st.id)}`);
        await nextFrame();
        await this.precompile(st);
        i++;
      }
      this.ui.setLoading(1, 'Prêt');
      this.bindGlobalEvents();
      this.stage = this.title;
      this.title.enter(this.host);
      this.graphics.post.fade = 1;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
      await new Promise((r) => setTimeout(r, 350));
      this.ui.hideLoading();

      const dev = this.params.get('dev');
      if (dev) {
        // Accès direct (développement et tests automatisés).
        this.devStart(dev);
      } else {
        this.mode = 'gate';
        this.ui.showGate(true);
        this.fadeTo(0.35, 2.5);
      }
    } catch (e) {
      console.error(e);
      this.mode = 'error';
      this.ui.hideLoading();
      this.ui.showError('Une erreur est survenue', 'PARALLAX n’a pas pu démarrer.', e instanceof Error ? e.message : String(e));
    }
  }

  private async precompile(st: Stage): Promise<void> {
    const r = this.graphics.renderer;
    const cam = this.director.camera;
    try {
      await r.compileAsync(st.scene, cam);
    } catch {
      r.compile(st.scene, cam);
    }
    // Un rendu hors écran force aussi la création des cartes d'ombre et des cibles.
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.graphics.post.sceneTarget);
    r.render(st.scene, cam);
    r.setRenderTarget(null);
  }

  private makeHost(): StageHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;
    return {
      get player() {
        return app.player;
      },
      get director() {
        return app.director;
      },
      hint: (t, d) => {
        if (app.settings.data.hints) app.ui.hint(t, d);
      },
      clearHint: () => app.ui.clearHint(),
      chapterCard: (n, t, s) => app.ui.chapterCard(n, t, s),
      advance: (color = 0x000000, fadeOut = 1.2) => app.advance(color, fadeOut),
      advanceSeamless: (next, place) => app.advanceSeamless(next, place),
      finish: () => app.finish(),
      flash: (a, color) => {
        app.graphics.post.flash = Math.max(app.graphics.post.flash, a);
        if (color !== undefined) app.graphics.post.flashColor.setHex(color);
      },
      setFade: (a, color) => {
        app.fade = null;
        app.graphics.post.fade = a;
        if (color !== undefined) app.graphics.post.fadeColor.setHex(color);
      },
      reach: (n) => app.reach(n),
      get settingsHints() {
        return app.settings.data.hints;
      },
      get reducedMotion() {
        return app.settings.data.reducedMotion;
      },
      shake: (a, d) => app.director.shake(a, d),
    };
  }

  private bindGlobalEvents(): void {
    this.input.addLockListener((locked) => {
      if (!locked && this.mode === 'play' && !this.ending) this.pause();
    });
    this.input.onPauseRequest = () => {
      if (this.mode === 'play') this.pause();
      else if (this.mode === 'paused') this.resume();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.mode === 'play') this.pause();
        this.audio.suspend();
      } else if (this.mode !== 'paused') {
        this.audio.resume();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.ui.panelOpen && this.mode !== 'play') this.ui.closePanels();
      if (e.code === 'KeyP' && this.mode === 'play') this.pause();
    });
    this.graphics.canvas.addEventListener('click', () => {
      if (this.mode === 'play' && !this.input.pointerLocked) this.input.requestLock();
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mode === 'title' || this.mode === 'gate') {
        this.title.setMouse((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      }
    });
    this.settings.onChange(() => {
      this.applySettings();
      this.paintedPaused = false;
    });
    // Un redimensionnement efface le canevas : l'image figée de la pause doit être redessinée.
    window.addEventListener('resize', () => (this.paintedPaused = false));
  }

  private applySettings(): void {
    const d = this.settings.data;
    const g = this.graphics;
    if (g.profile !== d.quality) g.setProfile(d.quality, d.renderScale);
    else if (Math.abs(g.baseScale - d.renderScale) > 1e-3) g.setBaseScale(d.renderScale);
    g.adaptive = d.adaptiveResolution && !this.params.has('fixed');
    if (!g.adaptive && Math.abs(g.scale - d.renderScale) > 1e-3) g.setBaseScale(d.renderScale);
    g.targetFps = d.targetFps;
    this.audio.setVolumes(d.volMaster, d.volMusic, d.volSfx);
    if (this.player) {
      this.player.sensitivity = d.sensitivity;
      this.player.invertY = d.invertY;
      this.player.headBob = d.headBob;
      this.player.reducedMotion = d.reducedMotion;
    }
    if (this.director) this.director.reducedMotion = d.reducedMotion;
    surfaceDetail.bump = d.quality !== 'performance';
    if (this.ctx && this.ctx.quality !== g.preset) {
      this.ctx.quality = g.preset;
      for (const st of Object.values(this.stages)) st.applyQuality(g.preset);
    }
  }

  // ================================================================ Parcours
  private async onEnter(): Promise<void> {
    if (this.mode !== 'gate') return;
    this.mode = 'title';
    this.ui.showGate(false);
    await this.audio.init();
    this.applySettings();
    this.audio.setScene('title');
    this.audio.setSpace(4.5, 2.4, 0.9);
    this.title.resetIntro();
    this.fadeTo(0, 3.5);
    window.setTimeout(() => {
      if (this.mode === 'title') this.ui.showTitle(true, this.progress);
    }, 2600);
  }

  private toTitle(): void {
    this.audio.resume();
    this.ui.showPause(false);
    this.ui.showHUD(false);
    this.ui.showCredits(false);
    this.ui.clearHint();
    this.input.exitLock();
    this.mode = 'transition';
    this.fadeTo(1, 0.9, () => {
      this.switchStage('title');
      this.title.resetIntro();
      this.audio.setScene('title');
      this.mode = 'title';
      this.ending = false;
      this.freeRoam = false;
      this.fadeTo(0, 2.5);
      window.setTimeout(() => this.ui.showTitle(true, this.progress), 1800);
    });
  }

  /** Lance un chapitre (1..3) depuis le titre ou les menus. */
  startChapter(n: number, fresh: boolean): void {
    if (this.mode === 'transition') return;
    this.audio.init().then(() => this.applySettings());
    this.audio.resume();
    this.input.requestLock();
    this.ui.showTitle(false);
    this.ui.showCredits(false);
    this.ui.showPause(false);
    const id = STAGE_ORDER[clamp(n - 1, 0, 2)] ?? 'threshold';
    if (!this.stages[id]) return;
    if (fresh) this.progress = { reached: Math.max(1, this.progress.reached), completed: this.progress.completed };
    const fromTitle = this.stage === this.title;
    this.mode = 'transition';
    this.freeRoam = false;
    this.ending = false;
    if (fromTitle) {
      this.title.dive();
      this.audio.inst?.riser(this.audio.now(), 2.4, 0.07, 200, 5000);
    }
    this.fadeTo(1, fromTitle ? 2.4 : 1.0, () => {
      // Ce chapitre et les suivants repartent de zéro.
      for (let k = STAGE_ORDER.indexOf(id); k < STAGE_ORDER.length; k++) this.rebuildStage(STAGE_ORDER[k]);
      this.enterStage(id, true);
    }, fromTitle ? 0xf4e6cf : 0x000000);
  }

  private restartChapter(): void {
    const id = this.stage.id;
    if (!STAGE_ORDER.includes(id)) return this.toTitle();
    this.ui.showPause(false);
    this.input.requestLock();
    this.audio.resume();
    this.mode = 'transition';
    this.fadeTo(1, 0.8, () => {
      for (let k = STAGE_ORDER.indexOf(id); k < STAGE_ORDER.length; k++) this.rebuildStage(STAGE_ORDER[k]);
      this.enterStage(id, true);
    });
  }

  /** Reconstruit une scène à neuf (rejouer, recommencer un chapitre). */
  private rebuildStage(id: string): void {
    const make: Record<string, () => Stage> = {
      threshold: () => new ThresholdStage(),
      archipelago: () => new ArchipelagoStage(),
      vanishing: () => new VanishingStage(),
    };
    const old = this.stages[id];
    if (!old || !make[id]) return;
    if (old === this.stage) this.stage.exit();
    old.dispose();
    const st = make[id]();
    st.build(this.ctx);
    this.stages[id] = st;
  }

  private switchStage(id: string): void {
    const st = this.stages[id];
    if (this.stage && this.stage !== st) this.stage.exit();
    this.stage = st;
    st.enter(this.host);
    st.shadowDirty = true;
  }

  /** Entre dans une scène jouable : placement, musique, fondu, carton de titre. */
  private enterStage(id: string, card: boolean): void {
    this.switchStage(id);
    const st = this.stage;
    st.viaPortal = false;
    const sp = st.spawn;
    this.player.teleport(sp.frame, sp.x, sp.y, sp.z, sp.yaw, sp.pitch);
    this.player.frozen = true;
    this.director.release(0.001);
    this.audio.setScene(st.musicScene);
    this.audio.setSpace(...st.reverb);
    this.reach(st.chapter);
    this.ui.showHUD(true);
    this.lockHold = 0;
    if (card && st.card) window.setTimeout(() => this.ui.chapterCard(...st.card!), 900);
    if (st.chapter === 1) {
      window.setTimeout(() => this.ui.showControlsCard(true), 7000);
      window.setTimeout(() => this.ui.showControlsCard(false), 21000);
    }
    this.fadeTo(0, 2.6, () => {
      this.player.frozen = false;
      this.mode = 'play';
      st.begin();
      // Pointeur libéré pendant le fondu : on propose de reprendre plutôt que de laisser le joueur sans regard.
      if (!this.input.pointerLocked && !this.input.lockFailed && !this.params.has('dev')) this.pause();
    });
    this.mode = 'transition';
    // Le joueur peut regarder pendant le fondu d'entrée.
    window.setTimeout(() => {
      if (this.mode === 'transition' && this.stage === st) this.player.frozen = false;
    }, 1200);
  }

  /** Scène suivante avec fondu. */
  private advance(color: number, fadeOut: number): void {
    const next = this.stage.next;
    if (!next || !this.stages[next]) return this.finish();
    this.mode = 'transition';
    this.player.frozen = true;
    this.fadeTo(1, fadeOut, () => this.enterStage(next, true), color);
  }

  /** Scène suivante sans coupure (portail) : `place` positionne le joueur dans la nouvelle scène. */
  private advanceSeamless(next: string, place: (p: Player) => void): void {
    const st = this.stages[next];
    if (!st) return;
    this.ui.clearHint();
    this.switchStage(next);
    st.viaPortal = true;
    place(this.player);
    this.audio.setScene(st.musicScene);
    this.audio.setSpace(...st.reverb);
    this.reach(st.chapter);
    if (st.card) window.setTimeout(() => this.ui.chapterCard(...st.card!), 1500);
    st.begin();
  }

  private finish(): void {
    this.ending = true;
    this.progress.completed = true;
    Progress.save(this.progress);
    this.mode = 'credits';
    this.ui.showHUD(false);
    this.ui.clearHint();
    this.input.exitLock();
    window.setTimeout(() => this.ui.showCredits(true), 400);
  }

  private startFreeRoam(): void {
    this.ui.showCredits(false);
    this.freeRoam = true;
    this.ending = false;
    this.input.requestLock();
    this.mode = 'play';
    this.player.frozen = false;
    this.director.release(1.5);
    this.ui.showHUD(true);
    this.ui.hint('Exploration libre — prenez votre temps. {Échap} pour le menu.', 6);
  }

  private reach(chapter: number): void {
    if (chapter > this.progress.reached) {
      this.progress.reached = chapter;
      Progress.save(this.progress);
    }
  }

  private onFall(): void {
    if (this.mode !== 'play') return;
    this.player.frozen = true;
    this.fadeTo(1, 0.5, () => {
      this.player.respawnAtSafe();
      this.fadeTo(0, 0.9, () => (this.player.frozen = false));
    }, 0x000000);
  }

  private pause(): void {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.paintedPaused = false;
    this.audio.suspend();
    const chapter = this.stage.chapter;
    const roman = ['', 'I', 'II', 'III'][chapter] ?? '';
    this.ui.showPause(true, chapter ? `Chapitre ${roman} — ${this.stage.card?.[1] ?? ''}` : '');
    this.input.reset();
    // Le menu doit pouvoir recevoir les clics (pause par la touche P ou la manette).
    this.input.exitLock();
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.ui.showPause(false);
    this.input.requestLock();
    this.audio.resume();
    this.mode = 'play';
    this.last = performance.now();
  }

  private onContextLost(): void {
    this.mode = 'error';
    this.audio.suspend();
    this.ui.showError(
      'Le rendu graphique a été interrompu',
      'Le pilote graphique a réinitialisé le contexte WebGL (mise en veille, changement d’écran ou surcharge).',
      'Rechargez la page : votre progression par chapitre est conservée. Si cela se répète, choisissez le profil « Performances » dans les paramètres.',
    );
  }

  private devStart(dev: string): void {
    // dev=threshold | dev=title ...
    if (dev === 'title') {
      this.mode = 'title';
      this.title.resetIntro();
      if (this.params.has('skipintro')) this.title.skipIntro();
      this.fadeTo(0, 0.01);
      this.ui.showTitle(true, this.progress);
      return;
    }
    const id = this.stages[dev] ? dev : 'threshold';
    this.switchStage(id);
    const st = this.stage;
    this.player.teleport(st.spawn.frame, st.spawn.x, st.spawn.y, st.spawn.z, st.spawn.yaw, st.spawn.pitch);
    const cam = this.params.get('cam');
    if (cam) {
      const [x, y, z, yaw, pitch] = cam.split(',').map(Number);
      this.player.teleport(st.mainFrame, x, y, z, ((yaw || 0) * Math.PI) / 180, ((pitch || 0) * Math.PI) / 180);
    }
    this.graphics.post.fade = 0;
    this.mode = 'play';
    this.ui.showHUD(!this.params.has('nohud'));
    st.begin();
  }

  // ================================================================ Fondus
  private fadeTo(to: number, dur: number, then?: () => void, color?: number): void {
    if (color !== undefined) this.graphics.post.fadeColor.setHex(color);
    this.fade = { from: this.graphics.post.fade, to, dur: Math.max(0.001, dur), t: 0, then };
  }

  private updateFade(dt: number): void {
    const f = this.fade;
    if (!f) return;
    f.t += dt;
    const k = clamp(f.t / f.dur);
    const e = k * k * (3 - 2 * k);
    this.graphics.post.fade = f.from + (f.to - f.from) * e;
    if (k >= 1) {
      this.fade = null;
      f.then?.();
    }
  }

  // ================================================================ Boucle
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const rawDt = Math.min(0.1, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    const dt = Math.min(0.05, rawDt) * this.timeScale;
    this.frames++;
    try {
      this.updateFps(rawDt);
      if (this.mode === 'paused') {
        // Image figée : on ne redessine qu'une fois.
        if (!this.paintedPaused) {
          this.render();
          this.paintedPaused = true;
        }
        return;
      }
      if (this.mode === 'error') return;
      this.time += dt;
      globalUniforms.uTime.value = this.time;
      this.update(dt);
      this.render();
      this.graphics.adaptResolution(rawDt);
    } catch (e) {
      console.error(e);
      this.errors.push(e instanceof Error ? e.message : String(e));
    }
  };

  private update(dt: number): void {
    this.input.pollGamepad(dt);
    this.updateFade(dt);
    this.audio.update(dt);
    const p = this.player;
    const st = this.stage;
    const post = this.graphics.post;

    if (st === this.title) {
      this.title.update(dt, this.director.camera);
      this.title.cameraPose(dt, this.titlePose, this.graphics.aspect);
      this.director.setAspect(this.graphics.aspect);
      this.director.update(dt, this.titlePose);
    } else {
      const controllable = (this.mode === 'play' || this.mode === 'transition') && (this.input.pointerLocked || this.input.lockFailed || this.params.has('dev'));
      p.observing = controllable && !p.frozen && (this.input.observing() || this.forceObserve);
      p.update(dt, controllable ? this.input : null);
      this.updateLocking(dt);
      p.computeWorldPose(this.playerPose.pos, this.playerPose.quat);
      this.playerPose.fov = this.settings.data.fov + p.fovOffset;
      this.director.setAspect(this.graphics.aspect);
      this.director.update(dt, this.playerPose);
      st.update(dt, this.director.camera);
      this.audio.music?.setIntensity(st.musicIntensity());
      st.playTime += this.mode === 'play' && !st.busy ? dt : 0;
      // Vignette d'observation.
      post.focus = damp(post.focus, p.observing ? 1 : 0, 5, dt);
    }
    // Étalonnage de la scène.
    lerpGrade(post.grade, st.grade, st.grade, 0);
    post.flash = damp(post.flash, 0, 2.2, dt);
    this.audio.updateListener(this.director.camera);
  }

  /** Alignement des anamorphoses, maintien du regard et verrouillage. */
  private updateLocking(dt: number): void {
    const p = this.player;
    let best: Anamorphosis | null = null;
    for (const a of this.stage.anamorphoses) {
      a.update(p);
      if (a.state === 'idle' && (!best || a.alignment > best.alignment)) best = a;
    }
    const canLock = !!best && this.mode === 'play' && !p.frozen && !p.gliding && best.canLock(p);
    if (canLock && p.observing) {
      this.lockHold += dt / 0.6;
      if (this.lockHold >= 1) {
        this.lockHold = 0;
        this.beginLock(best!);
      }
    } else {
      this.lockHold = Math.max(0, this.lockHold - dt * 3);
    }
    const show = this.mode === 'play' && !p.frozen;
    this.ui.setAlignment(show && best ? best.alignment : 0, canLock, this.lockHold, show, p.observing);
  }

  private beginLock(a: Anamorphosis): void {
    const p = this.player;
    a.state = 'locking';
    const { yaw, pitch } = a.viewAngles();
    p.frozen = true;
    if (this.audio.ready) this.audio.inst.riser(this.audio.now(), 1.25, 0.06, 400, 6000);
    p.glideTo(a.foot.x, a.foot.y, a.foot.z, yaw, pitch, 1.25, () => {
      a.state = 'locked';
      this.stage.onLock(a);
    });
  }

  private render(): void {
    const g = this.graphics;
    const r = g.renderer;
    r.info.reset();
    const st = this.stage;
    if (st.shadowDirty || st.shadowLive) {
      r.shadowMap.needsUpdate = true;
      st.shadowDirty = false;
    }
    const cam = this.director.camera;
    if (cam.far !== st.far) {
      cam.far = st.far;
      cam.updateProjectionMatrix();
    }
    st.preRender(g, cam);
    g.render(st.scene, cam, this.time);
  }

  private updateFps(rawDt: number): void {
    const show = this.settings.data.showFps || this.params.has('fps');
    const f = this.fpsAcc;
    f.t += rawDt;
    f.n++;
    if (f.t >= 0.5) {
      const fps = f.n / f.t;
      const info = this.graphics.renderer.info;
      f.text = `${fps.toFixed(0)} i/s · ${((1000 * f.t) / f.n).toFixed(1)} ms<br/>${this.graphics.width}×${this.graphics.height} (${Math.round(this.graphics.scale * 100)} %)<br/>${info.render.calls} appels · ${(info.render.triangles / 1000).toFixed(0)} k tri.`;
      f.t = 0;
      f.n = 0;
      (window as unknown as { __fps: number }).__fps = fps;
    }
    this.ui.setFps(show, f.text);
  }

  // ================================================================ Tests
  /** Interface de pilotage pour les tests automatisés (Playwright). */
  get debug() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;
    return {
      state: () => ({
        mode: app.mode,
        stage: app.stage?.id,
        pos: app.player?.pos.toArray(),
        yaw: app.player?.yaw,
        pitch: app.player?.pitch,
        frame: app.player?.frame.name,
        anam: app.stage?.anamorphoses.map((a) => ({ name: a.name, state: a.state, alignment: +a.alignment.toFixed(3), distance: +a.distance.toFixed(2) })),
        busy: app.stage?.busy,
        fade: app.graphics?.post.fade,
        errors: [...app.errors, ...Sequence.errors, ...app.audio.errors],
        frames: app.frames,
        audio: app.audio.ready,
        scale: app.graphics?.scale,
        freeRoam: app.freeRoam,
      }),
      enter: () => app.onEnter(),
      start: (n = 1) => app.startChapter(n, n === 1),
      teleport: (x: number, y: number, z: number, yawDeg: number, pitchDeg = 0) =>
        app.player.teleport(app.player.frame, x, y, z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180),
      setTimeScale: (s: number) => (app.timeScale = s),
      observe: (on: boolean) => (app.forceObserve = on),
      audioLevels: () => app.audio.levels(),
      /** Place le joueur au point de vue d'une anamorphose et le fait observer. */
      solve: (name?: string) => {
        const a = app.stage.anamorphoses.find((x) => x.state === 'idle' && (!name || x.name === name));
        if (!a) return false;
        const { yaw, pitch } = a.viewAngles();
        app.player.teleport(a.frame, a.foot.x, a.foot.y, a.foot.z, yaw, pitch);
        app.forceObserve = true;
        return true;
      },
      walkTo: (x: number, z: number) => {
        const p = app.player;
        p.teleport(p.frame, x, p.pos.y + 0.3, z, p.yaw, p.pitch);
      },
      key: (code: string, down: boolean) => app.input.simulateKey(code, down),
      pause: () => app.pause(),
      resume: () => app.resume(),
    };
  }

  /** Pose de caméra courante (tests). */
  cameraPose(): CamPose {
    const c = this.director.camera;
    return { pos: c.position.clone(), quat: c.quaternion.clone(), fov: c.fov };
  }
}

function stageLabel(id: string): string {
  return (
    {
      title: 'le titre',
      threshold: 'I. Le Seuil',
      archipelago: 'II. L’Archipel',
      vanishing: 'III. Le Point de fuite',
    } as Record<string, string>
  )[id] ?? id;
}

export type { THREE };
