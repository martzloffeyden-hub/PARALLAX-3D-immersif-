import * as THREE from 'three';
import type { Atmosphere } from '../render/Atmosphere';
import type { Graphics } from '../render/Graphics';
import type { ProceduralTextureSet } from '../render/ProceduralTextures';
import type { QualityPreset } from '../render/Quality';
import { defaultGrade, type GradeParams } from '../render/PostFX';
import type { Sky } from '../world/Sky';
import { GravityFrame, type Player } from '../player/Player';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Anamorphosis } from '../world/Anamorphosis';
import type { MusicScene } from '../audio/Music';
import { Sequence } from '../util/Sequence';

export interface StageContext {
  graphics: Graphics;
  textures: ProceduralTextureSet;
  quality: QualityPreset;
  audio: AudioEngine;
  /** Accès aux autres scènes (portails). */
  stage(id: string): Stage | undefined;
}

export interface Spawn {
  frame: GravityFrame;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Services fournis par l'application à la scène active. */
export interface StageHost {
  player: Player;
  /** Prend le contrôle de la caméra (cinématique) avec un fondu. */
  director: import('../app/Director').Director;
  hint(text: string, duration?: number): void;
  clearHint(): void;
  chapterCard(num: string, title: string, subtitle: string): void;
  /** Passe à la scène suivante avec un fondu (couleur, durée). */
  advance(color?: number, fadeOut?: number): void;
  /** Passe à la scène suivante sans coupure : le joueur garde sa pose monde. */
  advanceSeamless(next: string, place: (player: Player) => void): void;
  /** Termine l'expérience (finale → générique). */
  finish(): void;
  /** Effets de post-traitement transitoires. */
  flash(amount: number, color?: number): void;
  setFade(amount: number, color?: number): void;
  /** Sauvegarde la progression. */
  reach(chapter: number): void;
  readonly settingsHints: boolean;
  readonly reducedMotion: boolean;
  /** Secousse de caméra (intensité 0..1, durée en secondes). */
  shake(amount: number, duration: number): void;
}

export abstract class Stage {
  readonly scene = new THREE.Scene();
  abstract readonly id: string;
  abstract readonly chapter: number;
  atmosphere!: Atmosphere;
  sky!: Sky;
  sun!: THREE.DirectionalLight;
  readonly root = new THREE.Group();
  mainFrame: GravityFrame;
  frames: GravityFrame[] = [];
  grade: GradeParams = defaultGrade();
  spawn!: Spawn;
  anamorphoses: Anamorphosis[] = [];
  envMap: THREE.Texture | null = null;
  /** La carte d'ombre doit être recalculée à la prochaine image. */
  shadowDirty = true;
  /** Laisser la carte d'ombre se recalculer en continu (objets en mouvement). */
  shadowLive = false;
  time = 0;
  host: StageHost | null = null;
  /** Plage de champ lointain de la caméra pour cette scène. */
  far = 2500;
  ctx!: StageContext;
  /** Ambiance musicale du chapitre. */
  musicScene: MusicScene = 'silence';
  /** Réverbération : durée, décroissance, niveau. */
  reverb: [number, number, number] = [3.5, 2.6, 0.9];
  /** Carton de chapitre affiché à l'entrée. */
  card: [string, string, string] | null = null;
  /** Identifiant de la scène suivante. */
  next: string | null = null;
  /** Séquences scriptées en cours. */
  protected sequences: Sequence[] = [];
  /** Temps passé en jeu dans la scène (hors cinématiques), pour les indices. */
  playTime = 0;
  /** Vrai si l'on est arrivé par un portail (sans coupure). */
  viaPortal = false;

  constructor() {
    this.scene.add(this.root);
    this.mainFrame = new GravityFrame('main', this.root);
    this.frames.push(this.mainFrame);
  }

  abstract build(ctx: StageContext): void;

  /** Appelé quand la scène devient active. */
  enter(host: StageHost): void {
    this.host = host;
  }

  /** Appelé quand le joueur prend la main (après le fondu d'entrée). */
  begin(): void {}

  /** Un point de vue vient d'être verrouillé. */
  onLock(_a: Anamorphosis): void {}

  /** Intensité musicale (0..1) selon la progression. */
  musicIntensity(): number {
    return 0;
  }

  /** Lance une séquence scriptée. */
  protected play(seq: Sequence): Sequence {
    this.sequences.push(seq);
    return seq;
  }

  protected updateSequences(dt: number): void {
    for (const s of this.sequences) s.update(dt);
    this.sequences = this.sequences.filter((s) => !s.finished);
  }

  get busy(): boolean {
    return this.sequences.length > 0;
  }

  exit(): void {
    this.host = null;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.tickAmbient(dt, camera);
    this.updateSequences(dt);
  }

  /** Animations purement visuelles (aussi appelées quand la scène est vue par un portail). */
  tickAmbient(dt: number, _camera: THREE.Camera): void {
    this.time += dt;
    this.sky?.update(this.time);
  }

  /** Rendu préalable spécifique (portails, reflets) avant le rendu principal. */
  preRender(_graphics: Graphics, _camera: THREE.PerspectiveCamera, _w?: number, _h?: number): void {}

  /** Génère la carte d'environnement (éclairage indirect) depuis le ciel. */
  protected buildEnvironment(renderer: THREE.WebGLRenderer, extra?: THREE.Object3D[]): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const skyClone = new THREE.Mesh(this.sky.mesh.geometry, this.sky.material);
    envScene.add(skyClone);
    if (extra) for (const e of extra) envScene.add(e);
    this.sky.uniforms.uEnvPass.value = 1;
    const rt = pmrem.fromScene(envScene, 0, 0.1, 3000);
    this.sky.uniforms.uEnvPass.value = 0;
    this.envMap?.dispose();
    this.envMap = rt.texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();
  }

  /** Configure la lumière solaire et son ombre portée sur une zone. */
  protected setupSun(color: THREE.Color, intensity: number, center: THREE.Vector3, halfSize: number, depth: number, mapSize: number, radius: number): void {
    const sun = new THREE.DirectionalLight(color, intensity);
    const dir = this.atmosphere.uniforms.uSunDir.value;
    sun.position.copy(center).addScaledVector(dir, depth * 0.5);
    sun.target.position.copy(center);
    sun.castShadow = true;
    const cam = sun.shadow.camera;
    cam.left = -halfSize;
    cam.right = halfSize;
    cam.top = halfSize;
    cam.bottom = -halfSize;
    cam.near = 1;
    cam.far = depth;
    cam.updateProjectionMatrix();
    sun.shadow.mapSize.set(mapSize, mapSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = radius;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  /** Applique un nouveau profil graphique sans reconstruire la scène. */
  applyQuality(q: QualityPreset): void {
    if (this.sun && this.sun.castShadow) {
      const sh = this.sun.shadow;
      if (sh.mapSize.x !== q.shadowMapSize) {
        sh.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        sh.map?.dispose();
        (sh as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
      }
      sh.radius = q.shadowRadius;
      this.shadowDirty = true;
    }
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.envMap?.dispose();
    this.sun?.shadow.map?.dispose();
  }
}
