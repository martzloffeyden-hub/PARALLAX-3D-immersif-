import * as THREE from 'three';
import { PostFX } from './PostFX';
import { QUALITY_PRESETS, type QualityPreset } from './Quality';
import type { QualityProfile } from '../app/Settings';

/**
 * Enveloppe du WebGLRenderer : taille interne, profils, résolution adaptative,
 * rendu HDR + post-traitement.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly post: PostFX;
  preset: QualityPreset;
  profile: QualityProfile;
  /** Échelle de résolution courante (fraction du nombre de pixels CSS × dpr). */
  scale = 0.85;
  baseScale = 0.85;
  adaptive = true;
  targetFps = 60;
  readonly hdrType: THREE.TextureDataType;
  readonly gpuName: string;
  width = 1;
  height = 1;
  private dyn = { acc: 0, frames: 0, cooldown: 2, upCredit: 0, badLevel: 99 };
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(container: HTMLElement, profile: QualityProfile, gpuName: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'gl';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.gpuName = gpuName;
    const r = this.renderer;
    r.autoClear = false;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.info.autoReset = false;
    const ext = r.extensions;
    this.hdrType = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.profile = profile;
    this.preset = QUALITY_PRESETS[profile];
    this.post = new PostFX(r, this.preset.msaa, this.hdrType);
    this.applyPreset();

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    this.canvas.addEventListener('webglcontextrestored', () => this.onContextRestored?.());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setProfile(profile: QualityProfile, baseScale: number): void {
    this.profile = profile;
    this.preset = QUALITY_PRESETS[profile];
    this.baseScale = baseScale;
    this.scale = Math.min(this.preset.maxScale, Math.max(this.preset.minScale, baseScale));
    this.dyn.badLevel = 99;
    this.applyPreset();
    this.resize();
  }

  private applyPreset(): void {
    this.post.setMSAA(this.preset.msaa);
    this.post.fxaaEnabled = this.preset.fxaa;
    this.post.caEnabled = this.preset.chromaticAberration;
    this.post.setBloomLevels(this.preset.bloomLevels);
  }

  setBaseScale(s: number): void {
    this.baseScale = s;
    this.scale = s;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.maxDpr);
    const cw = Math.max(1, window.innerWidth);
    const ch = Math.max(1, window.innerHeight);
    const w = Math.max(320, Math.round(cw * dpr * this.scale));
    const h = Math.max(180, Math.round(ch * dpr * this.scale));
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.post.setSize(w, h);
  }

  get aspect(): number {
    return this.width / this.height;
  }

  /**
   * Résolution adaptative : abaisse la résolution quand l'image dépasse le budget,
   * la remonte prudemment quand il reste de la marge (avec hystérésis).
   */
  adaptResolution(frameDt: number): void {
    if (!this.adaptive) return;
    const d = this.dyn;
    d.cooldown -= frameDt;
    d.acc += frameDt;
    d.frames++;
    if (d.acc < 1.0) return;
    const avg = d.acc / d.frames;
    d.acc = 0;
    d.frames = 0;
    if (d.cooldown > 0) return;
    const budget = 1 / this.targetFps;
    const min = this.preset.minScale;
    const max = Math.min(this.preset.maxScale, Math.max(this.baseScale, min));
    const step = 0.05;
    if (avg > budget * 1.18 && this.scale > min + 0.001) {
      d.badLevel = this.scale;
      this.scale = Math.max(min, this.scale - (avg > budget * 1.6 ? step * 2 : step));
      d.cooldown = 1.5;
      d.upCredit = 0;
      this.resize();
    } else if (avg < budget * 1.04) {
      d.upCredit++;
      const next = Math.min(max, this.scale + step);
      // On remonte après plusieurs secondes stables, jamais jusqu'au palier qui a posé problème récemment.
      if (d.upCredit >= 4 && next > this.scale + 0.001 && next < d.badLevel - 0.001) {
        this.scale = next;
        d.upCredit = 0;
        d.cooldown = 2;
        this.resize();
      }
      if (d.upCredit > 30) d.badLevel = 99;
    } else {
      d.upCredit = 0;
    }
  }

  /** Rendu de la scène dans la cible HDR puis post-traitement vers l'écran. */
  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    const r = this.renderer;
    r.setRenderTarget(this.post.sceneTarget);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    this.post.render(time);
  }

  dispose(): void {
    this.post.dispose();
    this.renderer.dispose();
  }
}
