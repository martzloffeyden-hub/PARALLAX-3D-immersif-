import type * as THREE from 'three';
import type { AudioEngine, TuningVoice, LoopHandle, Ambience } from './AudioEngine';
import type { Surface } from '../player/Colliders';
import type { MusicScene } from './Music';

// Instruments et effets synthétisés. Chaque fonction programme ses nœuds à un
// instant donné et les libère d'elle-même (stop programmé).

type Dest = AudioNode;

export class Instruments {
  private softWave: PeriodicWave;
  private reedWave: PeriodicWave;

  constructor(private e: AudioEngine) {
    const ctx = e.ctx!;
    // Spectre doux (harmoniques en 1/n^1.6) : nappe chaude sans dureté.
    const n = 24;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 1; i < n; i++) im[i] = 1 / Math.pow(i, 1.6);
    this.softWave = ctx.createPeriodicWave(re, im);
    const im2 = new Float32Array(n);
    for (let i = 1; i < n; i++) im2[i] = (i % 2 ? 1 : 0.35) / Math.pow(i, 1.2);
    this.reedWave = ctx.createPeriodicWave(re, im2);
  }

  private get ctx(): AudioContext {
    return this.e.ctx!;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number, sustain = 0, hold = 0): void {
    const p = g.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (sustain > 0) {
      p.setTargetAtTime(sustain, t + a, d / 3);
      if (hold > 0) p.setTargetAtTime(0.0001, t + a + hold, d / 3);
    } else {
      p.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
  }

  private sends(node: AudioNode, reverb: number, delay = 0): void {
    if (reverb > 0) {
      const g = this.ctx.createGain();
      g.gain.value = reverb;
      node.connect(g).connect(this.e.reverbIn);
    }
    if (delay > 0) {
      const g = this.ctx.createGain();
      g.gain.value = delay;
      node.connect(g).connect(this.e.delayIn);
    }
  }

  // ------------------------------------------------------------ Musique
  /** Nappe : oscillateurs doux désaccordés, filtre lent, enveloppe longue. */
  pad(freqs: number[], t: number, dur: number, o: { gain?: number; cutoff?: number; attack?: number; release?: number; reverb?: number; dest?: Dest; reed?: boolean } = {}): void {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const cut = o.cutoff ?? 1100;
    lp.frequency.setValueAtTime(cut * 0.5, t);
    lp.frequency.linearRampToValueAtTime(cut, t + (o.attack ?? 3) + dur * 0.3);
    lp.frequency.linearRampToValueAtTime(cut * 0.6, t + dur + (o.release ?? 4));
    lp.Q.value = 0.4;
    lp.connect(out);
    out.connect(o.dest ?? this.e.musicBus);
    this.sends(out, o.reverb ?? 0.55);
    const att = o.attack ?? 3;
    const rel = o.release ?? 4;
    const peak = (o.gain ?? 0.05) / Math.sqrt(freqs.length);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(peak, t + att);
    out.gain.setValueAtTime(peak, t + att + Math.max(0, dur - att));
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    const end = t + dur + rel + 0.1;
    for (const f of freqs) {
      for (const det of [-6, 5]) {
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(o.reed ? this.reedWave : this.softWave);
        osc.frequency.value = f;
        osc.detune.value = det + (Math.random() - 0.5) * 4;
        const og = ctx.createGain();
        og.gain.value = 0.5;
        // légère respiration du volume
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07 + Math.random() * 0.1;
        const lg = ctx.createGain();
        lg.gain.value = 0.12;
        lfo.connect(lg).connect(og.gain);
        osc.connect(og).connect(lp);
        osc.start(t);
        lfo.start(t);
        osc.stop(end);
        lfo.stop(end);
      }
    }
  }

  /** Cloche FM (rapport inharmonique) — les « éclats » mélodiques. */
  bell(f: number, t: number, o: { gain?: number; decay?: number; ratio?: number; index?: number; reverb?: number; delay?: number; pan?: number; dest?: Dest } = {}): void {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const out = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * (o.ratio ?? 3.5);
    const idx = (o.index ?? 1.8) * f;
    mg.gain.setValueAtTime(idx, t);
    mg.gain.exponentialRampToValueAtTime(idx * 0.02 + 0.01, t + (o.decay ?? 3) * 0.5);
    mod.connect(mg).connect(car.frequency);
    const dec = o.decay ?? 3;
    this.env(out, t, 0.004, o.gain ?? 0.06, dec);
    let node: AudioNode = out;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      out.connect(p);
      node = p;
    }
    car.connect(out);
    node.connect(o.dest ?? this.e.musicBus);
    this.sends(node, o.reverb ?? 0.5, o.delay ?? 0.15);
    car.start(t);
    mod.start(t);
    car.stop(t + dec + 0.2);
    mod.stop(t + dec + 0.2);
  }

  /** Note de « piano de verre » : partiels sinusoïdaux à décroissance rapide. */
  glass(f: number, t: number, o: { gain?: number; decay?: number; reverb?: number; delay?: number; pan?: number; dest?: Dest } = {}): void {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const dec = o.decay ?? 1.6;
    this.env(out, t, 0.003, o.gain ?? 0.05, dec);
    const partials: [number, number][] = [
      [1, 1],
      [2.002, 0.35],
      [3.01, 0.12],
      [4.2, 0.05],
    ];
    for (const [m, a] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(a * 0.01 + 0.0001, t + dec / m);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + dec + 0.1);
    }
    let node: AudioNode = out;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      out.connect(p);
      node = p;
    }
    node.connect(o.dest ?? this.e.musicBus);
    this.sends(node, o.reverb ?? 0.45, o.delay ?? 0.25);
  }

  /** Basse profonde (sinus + légère saturation). */
  sub(f: number, t: number, dur: number, gain = 0.12, dest?: Dest): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(gain, t + Math.min(2, dur * 0.3));
    out.gain.setValueAtTime(gain, t + dur * 0.7);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(out);
    o2.connect(g2).connect(out);
    out.connect(dest ?? this.e.musicBus);
    osc.start(t);
    o2.start(t);
    osc.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }

  /** Timbale / impact grave synthétique. */
  timpani(f: number, t: number, gain = 0.3, dest?: Dest): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const out = ctx.createGain();
    this.env(out, t, 0.003, gain, 1.6);
    const n = this.e.noiseSource();
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 600;
    const ng = ctx.createGain();
    this.env(ng, t, 0.002, gain * 0.5, 0.18);
    n.connect(nf).connect(ng).connect(out);
    osc.connect(out);
    out.connect(dest ?? this.e.musicBus);
    this.sends(out, 0.6);
    n.start(t, Math.random() * 3);
    n.stop(t + 0.4);
    osc.start(t);
    osc.stop(t + 1.8);
  }

  /** Souffle montant (bruit filtré dont la fréquence s'élève). */
  riser(t: number, dur: number, gain = 0.08, f0 = 300, f1 = 6000, dest?: Dest): void {
    const ctx = this.ctx;
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    n.connect(bp).connect(g).connect(dest ?? this.e.sfxBus);
    this.sends(g, 0.5);
    n.start(t, Math.random() * 3);
    n.stop(t + dur + 0.4);
  }

  /** Impact grave (boum) — verrouillages, chocs architecturaux. */
  boom(t: number, gain = 0.5, f = 52, dest?: Dest): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 2.4, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.22);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 2.5);
    const out = ctx.createGain();
    this.env(out, t, 0.005, gain, 2.8);
    osc.connect(out);
    const n = this.e.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    const ng = ctx.createGain();
    this.env(ng, t, 0.003, gain * 0.45, 0.9);
    n.connect(lp).connect(ng).connect(out);
    out.connect(dest ?? this.e.sfxBus);
    this.sends(out, 0.7);
    osc.start(t);
    n.start(t, Math.random() * 3);
    osc.stop(t + 3);
    n.stop(t + 1.2);
  }

  // ------------------------------------------------------------ Effets
  footstep(surface: Surface, intensity: number, pan: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const base = surface === 'metal' ? 3200 : surface === 'glass' ? 4200 : surface === 'water' ? 900 : 1500;
    bp.frequency.value = base * (0.85 + Math.random() * 0.3);
    bp.Q.value = surface === 'metal' ? 8 : 0.9;
    const g = ctx.createGain();
    const v = 0.05 + intensity * 0.06;
    this.env(g, t, 0.002, v, surface === 'water' ? 0.25 : 0.09 + Math.random() * 0.03);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    n.connect(bp).connect(g).connect(p).connect(this.e.sfxBus);
    this.sends(p, 0.12);
    n.start(t, Math.random() * 3.5);
    n.stop(t + 0.35);
    // talon : petite masse grave
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const og = ctx.createGain();
    this.env(og, t, 0.002, 0.05 * intensity, 0.08);
    o.connect(og).connect(p);
    o.start(t);
    o.stop(t + 0.12);
  }

  thump(gain: number): void {
    const t = this.ctx.currentTime + 0.005;
    this.boom(t, 0.12 * gain, 60);
  }

  uiTick(f: number, gain: number, f2?: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.003;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    this.env(g, t, 0.002, gain, 0.06);
    o.connect(g).connect(this.e.sfxBus);
    this.sends(g, 0.2);
    o.start(t);
    o.stop(t + 0.1);
    if (f2) {
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f2;
      const g2 = ctx.createGain();
      this.env(g2, t + 0.035, 0.002, gain * 0.7, 0.12);
      o2.connect(g2).connect(this.e.sfxBus);
      this.sends(g2, 0.3);
      o2.start(t + 0.035);
      o2.stop(t + 0.2);
    }
  }

  /** Coup de pierre accordé (assemblage du pont) — spatialisé. */
  stone(pos: THREE.Vector3, f: number, gain = 0.4): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const pan = this.e.panner(pos, 6, 0.8);
    pan.connect(this.e.sfxBus);
    this.sends(pan, 0.5);
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 4;
    bp.Q.value = 3;
    const ng = ctx.createGain();
    this.env(ng, t, 0.001, gain * 0.7, 0.07);
    n.connect(bp).connect(ng).connect(pan);
    n.start(t, Math.random() * 3);
    n.stop(t + 0.2);
    // résonance tonale (bloc de pierre « marimba »)
    for (const [m, a, d] of [
      [1, 1, 1.1],
      [3.93, 0.3, 0.35],
      [9.2, 0.08, 0.12],
    ] as [number, number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * m;
      const g = ctx.createGain();
      this.env(g, t, 0.002, gain * a * 0.5, d);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + d + 0.1);
    }
    window.setTimeout(() => pan.disconnect(), 2500);
  }

  /** Grondement de pierre (architecture qui bouge) — spatialisé. */
  rumble(pos: THREE.Vector3 | null, dur: number, gain = 0.3): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const n = this.e.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    lp.Q.value = 0.7;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'bandpass';
    lp2.frequency.value = 420;
    lp2.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.4);
    g.gain.setValueAtTime(gain, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // modulation de grain (frottement irrégulier)
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 7;
    const lg = ctx.createGain();
    lg.gain.value = gain * 0.35;
    lfo.connect(lg).connect(g.gain);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    n.connect(lp).connect(g);
    n.connect(lp2).connect(g2).connect(g);
    let node: AudioNode = g;
    if (pos) {
      const p = this.e.panner(pos, 10, 0.6);
      g.connect(p);
      node = p;
    }
    node.connect(this.e.sfxBus);
    this.sends(node, 0.4);
    n.start(t, Math.random() * 3);
    lfo.start(t);
    n.stop(t + dur + 0.2);
    lfo.stop(t + dur + 0.2);
  }

  whoosh(dur: number, gain = 0.12, up = true): void {
    const t = this.ctx.currentTime + 0.005;
    this.riser(t, dur, gain, up ? 200 : 4000, up ? 3500 : 250);
  }

  /** Boucle continue spatialisée (portail, anneau). */
  hum(pos: THREE.Vector3, freqs: number[], gain = 0.08): LoopHandle {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(gain, t + 2);
    const pan = this.e.panner(pos, 6, 0.9);
    out.connect(pan).connect(this.e.sfxBus);
    this.sends(pan, 0.5);
    const oscs: OscillatorNode[] = [];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.softWave);
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.5 / freqs.length;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.3 + Math.random() * 0.8;
      const lg = ctx.createGain();
      lg.gain.value = 0.18 / freqs.length;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(out);
      o.start(t);
      lfo.start(t);
      oscs.push(o, lfo);
    }
    let stopped = false;
    return {
      setGain: (g, time = 0.3) => out.gain.setTargetAtTime(g, ctx.currentTime, time),
      setPosition: (p) => {
        pan.positionX.setTargetAtTime(p.x, ctx.currentTime, 0.05);
        pan.positionY.setTargetAtTime(p.y, ctx.currentTime, 0.05);
        pan.positionZ.setTargetAtTime(p.z, ctx.currentTime, 0.05);
      },
      stop: (fade = 1.5) => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, fade / 4);
        for (const o of oscs) o.stop(now + fade + 0.2);
        window.setTimeout(() => pan.disconnect(), (fade + 0.5) * 1000);
      },
    };
  }

  /**
   * L'accord d'alignement : des voix désaccordées proportionnellement au défaut
   * d'alignement, qui deviennent pures au point exact.
   */
  tuning(pos: THREE.Vector3, freqs: number[]): TuningVoice {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 0.5;
    const pan = this.e.panner(pos, 14, 0.7);
    lp.connect(out).connect(pan).connect(this.e.sfxBus);
    this.sends(pan, 0.55);
    const offsets = [38, -52, 66, -29, 47];
    const voices = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = (i === 0 ? 0.5 : 0.32) / freqs.length;
      o.connect(g).connect(lp);
      o.start(t);
      return { o, off: offsets[i % offsets.length] };
    });
    // Scintillement aigu qui n'apparaît qu'au voisinage de l'alignement parfait.
    const shim = ctx.createOscillator();
    shim.type = 'sine';
    shim.frequency.value = freqs[0] * 4;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.5;
    const tg = ctx.createGain();
    tg.gain.value = 0;
    trem.connect(tg).connect(sg.gain);
    shim.connect(sg).connect(out);
    shim.start(t);
    trem.start(t);
    let dead = false;
    let resolved = false;
    return {
      update: (a, prox) => {
        if (dead || resolved) return;
        const now = ctx.currentTime;
        const mis = Math.pow(1 - a, 1.4);
        for (const v of voices) v.o.detune.setTargetAtTime(v.off * mis, now, 0.08);
        const g = prox * prox * (0.22 + 0.78 * a) * 0.8;
        out.gain.setTargetAtTime(g, now, 0.12);
        lp.frequency.setTargetAtTime(500 + 3500 * a * a, now, 0.1);
        const s = Math.pow(Math.max(0, a - 0.75) / 0.25, 2) * 0.05;
        sg.gain.setTargetAtTime(s, now, 0.1);
        tg.gain.setTargetAtTime(s * 0.6, now, 0.1);
      },
      resolve: () => {
        if (dead || resolved) return;
        resolved = true;
        const now = ctx.currentTime;
        for (const v of voices) v.o.detune.setTargetAtTime(0, now, 0.05);
        lp.frequency.setTargetAtTime(5000, now, 0.2);
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.5, now, 0.15);
        out.gain.setTargetAtTime(0.0001, now + 1.2, 1.4);
        window.setTimeout(() => {
          if (dead) return;
          dead = true;
          for (const v of voices) v.o.stop();
          shim.stop();
          trem.stop();
          pan.disconnect();
        }, 9000);
      },
      dispose: () => {
        if (dead) return;
        dead = true;
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0, now, 0.2);
        window.setTimeout(() => {
          for (const v of voices) v.o.stop();
          shim.stop();
          trem.stop();
          pan.disconnect();
        }, 1200);
      },
    };
  }

  // ------------------------------------------------------------ Ambiances
  ambience(scene: MusicScene): Ambience {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(1, t + 5);
    out.connect(this.e.ambBus);
    const nodes: (AudioScheduledSourceNode)[] = [];
    const params: Record<string, AudioParam> = {};

    const wind = (center: number, q: number, gain: number, rate: number, depth: number) => {
      const n = this.e.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = center;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = center * depth;
      lfo.connect(lg).connect(bp.frequency);
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = rate * 0.61;
      const lg2 = ctx.createGain();
      lg2.gain.value = gain * 0.5;
      lfo2.connect(lg2).connect(g.gain);
      const pn = ctx.createStereoPanner();
      const lfo3 = ctx.createOscillator();
      lfo3.frequency.value = rate * 0.37;
      const lg3 = ctx.createGain();
      lg3.gain.value = 0.5;
      lfo3.connect(lg3).connect(pn.pan);
      n.connect(bp).connect(g).connect(pn).connect(out);
      n.start(t, Math.random() * 3);
      lfo.start(t);
      lfo2.start(t);
      lfo3.start(t);
      nodes.push(n, lfo, lfo2, lfo3);
      return g;
    };
    const tone = (f: number, gain: number, type: OscillatorType = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = gain * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(out);
      this.sends(g, 0.6);
      o.start(t);
      lfo.start(t);
      nodes.push(o, lfo);
      return g;
    };

    switch (scene) {
      case 'title':
        wind(500, 0.5, 0.03, 0.05, 0.4);
        tone(73.42, 0.02);
        break;
      case 'threshold':
        params.wind = wind(650, 0.6, 0.05, 0.06, 0.45).gain;
        wind(2400, 1.2, 0.008, 0.11, 0.3);
        tone(36.71, 0.035);
        break;
      case 'archipelago':
        params.wind = wind(380, 0.5, 0.08, 0.045, 0.5).gain;
        wind(1300, 0.9, 0.025, 0.08, 0.5);
        wind(120, 0.7, 0.06, 0.03, 0.3);
        tone(30.87, 0.04);
        break;
      case 'vanishing':
        params.wind = wind(300, 0.4, 0.025, 0.04, 0.4).gain;
        tone(27.5, 0.05);
        tone(55, 0.012, 'triangle');
        break;
      case 'epilogue':
        wind(700, 0.6, 0.03, 0.06, 0.4);
        tone(36.71, 0.025);
        break;
      default:
        break;
    }
    return {
      stop: (fade: number) => {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, fade / 4);
        for (const n of nodes) n.stop(now + fade + 0.5);
      },
      set: (param: string, value: number) => {
        const p = params[param];
        if (p) p.setTargetAtTime(value, ctx.currentTime, 0.5);
      },
    };
  }
}
