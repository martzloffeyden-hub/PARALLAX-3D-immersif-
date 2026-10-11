import * as THREE from 'three';
import type { Surface } from '../player/Colliders';
import { Instruments } from './Instruments';
import { Music, type MusicScene } from './Music';

// Moteur audio entièrement synthétique (Web Audio API) :
// bus musique / ambiances / effets → compresseur → limiteur,
// réverbération par convolution (réponse impulsionnelle générée), sons spatialisés HRTF.

export interface TuningVoice {
  update(alignment: number, proximity: number): void;
  /** Résout l'accord (désaccord → 0) puis l'éteint lentement. */
  resolve(): void;
  dispose(): void;
}

export interface LoopHandle {
  setGain(g: number, time?: number): void;
  setPosition(p: THREE.Vector3): void;
  stop(fade?: number): void;
}

export interface Ambience {
  stop(fade: number): void;
  set(param: string, value: number): void;
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export { midi };

export class AudioEngine {
  ctx: AudioContext | null = null;
  ready = false;
  master!: GainNode;
  musicBus!: GainNode;
  ambBus!: GainNode;
  sfxBus!: GainNode;
  reverbIn!: GainNode;
  delayIn!: GainNode;
  private reverb!: ConvolverNode;
  private reverbOut!: GainNode;
  noise!: AudioBuffer;
  inst!: Instruments;
  music!: Music;
  private vol = { master: 0.8, music: 0.75, sfx: 0.85 };
  private ambience: Ambience | null = null;
  private stepSide = 1;
  private suspendedByApp = false;
  /** Temps de jeu de secours quand l'audio est indisponible. */
  private fallbackClock = 0;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  /** Niveau de sortie le plus fort observé (contrôle qualité). */
  peakSeen = 0;

  async init(): Promise<void> {
    if (this.ctx) {
      await this.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      this.ctx = ctx;
      // Chaîne maître : compresseur doux puis limiteur.
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 18;
      comp.ratio.value = 2.5;
      comp.attack.value = 0.02;
      comp.release.value = 0.3;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 24;
      this.master.connect(hp).connect(comp).connect(limiter).connect(ctx.destination);
      // Mesure de niveau (contrôle qualité).
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      limiter.connect(this.analyser);

      this.musicBus = ctx.createGain();
      this.ambBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.ambBus.connect(this.master);
      this.sfxBus.connect(this.master);

      // Réverbération (départ partagé). Le retour suit le volume principal.
      this.reverbIn = ctx.createGain();
      this.reverb = ctx.createConvolver();
      this.reverb.normalize = true;
      this.reverb.buffer = this.makeImpulse(4.2, 2.6, 0.012);
      this.reverbOut = ctx.createGain();
      this.reverbOut.gain.value = 0.9;
      this.reverbIn.connect(this.reverb).connect(this.reverbOut).connect(this.master);

      // Écho ping-pong filtré.
      this.delayIn = ctx.createGain();
      const dl = ctx.createDelay(2);
      const dr = ctx.createDelay(2);
      dl.delayTime.value = 0.42;
      dr.delayTime.value = 0.63;
      const fb = ctx.createGain();
      fb.gain.value = 0.38;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      const merger = ctx.createChannelMerger(2);
      this.delayIn.connect(dl);
      dl.connect(lp).connect(dr);
      dr.connect(fb).connect(dl);
      dl.connect(merger, 0, 0);
      dr.connect(merger, 0, 1);
      const dOut = ctx.createGain();
      dOut.gain.value = 0.5;
      merger.connect(dOut);
      dOut.connect(this.master);
      dOut.connect(this.reverbIn);

      this.noise = this.makeNoise(4);
      this.inst = new Instruments(this);
      this.music = new Music(this);
      this.applyVolumes();
      if (ctx.state !== 'running') await ctx.resume();
      this.ready = true;
    } catch (e) {
      console.warn('Audio indisponible :', e);
      this.ctx = null;
      this.ready = false;
    }
  }

  async resume(): Promise<void> {
    this.suspendedByApp = false;
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  suspend(): void {
    this.suspendedByApp = true;
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => undefined);
  }

  get suspended(): boolean {
    return this.suspendedByApp;
  }

  /** Horloge de référence (audio si disponible). */
  now(): number {
    return this.ctx ? this.ctx.currentTime : this.fallbackClock;
  }

  tickFallback(dt: number): void {
    if (!this.ctx) this.fallbackClock += dt;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const curve = (v: number) => v * v;
    this.master.gain.setTargetAtTime(curve(this.vol.master) * 0.9, t, 0.05);
    this.musicBus.gain.setTargetAtTime(curve(this.vol.music) * 1.1, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(curve(this.vol.sfx), t, 0.05);
    this.ambBus.gain.setTargetAtTime(curve(this.vol.sfx) * 0.9, t, 0.05);
  }

  /** Réponse impulsionnelle stéréo : bruit à décroissance exponentielle, de plus en plus sombre. */
  makeImpulse(seconds: number, decay: number, predelay: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    const pre = Math.floor(predelay * rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / rate;
        const env = Math.pow(1 - (i - pre) / (len - pre), decay) * Math.exp(-t * 1.2);
        // filtre passe-bas qui se referme : la queue s'assombrit (absorption de l'air)
        const k = 0.75 - 0.6 * Math.min(1, t / seconds);
        lp = lp + (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * env;
      }
      // premières réflexions
      for (let r = 0; r < 12; r++) {
        const idx = pre + Math.floor((0.008 + Math.random() * 0.07) * rate);
        if (idx < len) d[idx] += (Math.random() * 2 - 1) * 0.5 * (1 - r / 12);
      }
    }
    return buf;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Source de bruit en boucle à décalage aléatoire. */
  noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  /** Crée un panoramique 3D (HRTF) à une position. */
  panner(pos: THREE.Vector3, refDistance = 4, rolloff = 1): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.maxDistance = 1000;
    p.rolloffFactor = rolloff;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    return p;
  }

  private _f = new THREE.Vector3();
  private _u = new THREE.Vector3();
  updateListener(cam: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    cam.getWorldDirection(this._f);
    this._u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const p = cam.position;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(this._f.x, t, 0.02);
      l.forwardY.setTargetAtTime(this._f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(this._f.z, t, 0.02);
      l.upX.setTargetAtTime(this._u.x, t, 0.02);
      l.upY.setTargetAtTime(this._u.y, t, 0.02);
      l.upZ.setTargetAtTime(this._u.z, t, 0.02);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
    }
  }

  /** Change de réverbération (taille de l'espace). */
  setSpace(seconds: number, decay: number, wet: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.reverbOut.gain.setTargetAtTime(0, t, 0.3);
    window.setTimeout(() => {
      if (!this.ctx) return;
      this.reverb.buffer = this.makeImpulse(seconds, decay, 0.015);
      this.reverbOut.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.8);
    }, 900);
  }

  /** Niveaux de sortie instantanés (RMS, crête) — pour les tests. */
  levels(): { rms: number; peak: number; nan: boolean } {
    if (!this.analyser) return { rms: 0, peak: 0, nan: false };
    if (!this.meterBuf) this.meterBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    let peak = 0;
    let nan = false;
    for (const v of this.meterBuf) {
      if (!Number.isFinite(v)) nan = true;
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    this.peakSeen = Math.max(this.peakSeen, peak);
    return { rms: Math.sqrt(sum / this.meterBuf.length), peak, nan };
  }

  // ---------------------------------------------------------------- Scènes
  setScene(scene: MusicScene): void {
    if (!this.ctx) return;
    this.music.setScene(scene);
    this.ambience?.stop(4);
    this.ambience = this.inst.ambience(scene);
  }

  setAmbience(param: string, v: number): void {
    this.ambience?.set(param, v);
  }

  update(dt: number): void {
    this.tickFallback(dt);
    if (!this.ctx || this.suspendedByApp) return;
    this.music.tick();
  }

  // ---------------------------------------------------------------- Effets
  footstep(surface: Surface, intensity: number): void {
    if (!this.ready) return;
    this.stepSide = -this.stepSide;
    this.inst.footstep(surface, intensity, this.stepSide * 0.12);
  }

  land(impact: number): void {
    if (!this.ready) return;
    this.inst.footstep('stone', 0.6 + impact * 0.6, 0);
    this.inst.thump(0.4 + impact * 0.6);
  }

  uiHover(): void {
    if (this.ready) this.inst.uiTick(2600, 0.035);
  }

  uiClick(): void {
    if (this.ready) this.inst.uiTick(1320, 0.07, 880);
  }

  createTuning(pos: THREE.Vector3, freqs: number[]): TuningVoice {
    if (!this.ready) return { update() {}, resolve() {}, dispose() {} };
    return this.inst.tuning(pos, freqs);
  }
}
