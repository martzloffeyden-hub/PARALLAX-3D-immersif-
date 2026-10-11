import type { AudioEngine } from './AudioEngine';
import { midi } from './AudioEngine';

// Partition générative : chaque chapitre a sa tonalité, ses accords, ses couches.
// L'intensité (0..1) ajoute des couches (arpèges, pulsation) au fil de la progression.

export type MusicScene = 'title' | 'threshold' | 'archipelago' | 'vanishing' | 'epilogue' | 'silence';

interface SceneDef {
  chords: number[][];
  chordDur: number;
  bass: number[];
  scale: number[];
  bellEvery: [number, number];
  padGain: number;
  padCut: number;
  bellGain: number;
  arpBpm: number;
  reed?: boolean;
}

const D_LYD = [74, 76, 78, 80, 81, 83, 85, 86, 88, 90];
const B_AEO = [71, 73, 74, 76, 78, 79, 81, 83, 85, 86];
const A_DOR = [69, 71, 72, 74, 76, 78, 79, 81, 83, 84];

const SCENES: Record<Exclude<MusicScene, 'silence'>, SceneDef> = {
  title: {
    chords: [
      [50, 57, 61, 64, 66],
      [50, 59, 64, 68],
      [50, 54, 61, 64, 68],
      [47, 54, 57, 61, 62],
    ],
    chordDur: 13,
    bass: [38, 38, 38, 35],
    scale: D_LYD,
    bellEvery: [3.5, 7.5],
    padGain: 0.07,
    padCut: 900,
    bellGain: 0.035,
    arpBpm: 0,
  },
  threshold: {
    chords: [
      [50, 57, 61, 64, 66],
      [50, 59, 64, 68, 71],
      [50, 54, 61, 64, 68],
      [47, 54, 57, 61, 62],
    ],
    chordDur: 12,
    bass: [38, 38, 38, 35],
    scale: D_LYD,
    bellEvery: [3, 7],
    padGain: 0.075,
    padCut: 1100,
    bellGain: 0.04,
    arpBpm: 84,
  },
  archipelago: {
    chords: [
      [47, 54, 57, 61, 62],
      [43, 50, 54, 59, 61],
      [40, 47, 50, 54, 55],
      [42, 49, 54, 59, 61],
    ],
    chordDur: 10,
    bass: [35, 31, 28, 30],
    scale: B_AEO,
    bellEvery: [2.5, 6],
    padGain: 0.08,
    padCut: 1000,
    bellGain: 0.04,
    arpBpm: 76,
    reed: true,
  },
  vanishing: {
    chords: [
      [45, 52, 55, 59, 62],
      [41, 48, 52, 57, 59],
      [43, 50, 52, 57, 59],
      [40, 47, 50, 55, 59],
    ],
    chordDur: 11,
    bass: [33, 29, 31, 28],
    scale: A_DOR,
    bellEvery: [2, 5],
    padGain: 0.07,
    padCut: 800,
    bellGain: 0.035,
    arpBpm: 92,
  },
  epilogue: {
    chords: [
      [50, 57, 61, 64, 66],
      [50, 59, 64, 68],
      [43, 50, 54, 59, 61, 64],
      [45, 52, 57, 61, 64],
    ],
    chordDur: 12,
    bass: [38, 38, 31, 33],
    scale: D_LYD,
    bellEvery: [2.5, 5.5],
    padGain: 0.07,
    padCut: 1200,
    bellGain: 0.04,
    arpBpm: 0,
  },
};

export class Music {
  scene: MusicScene = 'silence';
  private def: SceneDef | null = null;
  private layer: GainNode | null = null;
  intensity = 0;
  private nextChord = 0;
  private chordIdx = 0;
  private nextBell = 0;
  private nextArp = 0;
  private arpStep = 0;
  private nextPulse = 0;
  /** Finale scripté : temps de départ (horloge audio) ou -1. */
  finaleStart = -1;
  readonly finaleBpm = 92;
  private finaleScheduled = false;

  constructor(private e: AudioEngine) {}

  get beat(): number {
    return 60 / this.finaleBpm;
  }

  setScene(s: MusicScene): void {
    if (s === this.scene) return;
    const ctx = this.e.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.layer) {
      const old = this.layer;
      old.gain.cancelScheduledValues(now);
      old.gain.setTargetAtTime(0.0001, now, 1.8);
      window.setTimeout(() => old.disconnect(), 12000);
    }
    this.scene = s;
    this.intensity = 0;
    if (s === 'silence') {
      this.def = null;
      this.layer = null;
      return;
    }
    this.def = SCENES[s];
    this.layer = ctx.createGain();
    this.layer.gain.value = 1;
    this.layer.connect(this.e.musicBus);
    this.nextChord = now + 0.6;
    this.chordIdx = 0;
    this.nextBell = now + 4;
    this.nextArp = now + 2;
    this.nextPulse = now + 1;
    this.arpStep = 0;
  }

  setIntensity(x: number): void {
    this.intensity = Math.max(0, Math.min(1, x));
  }

  tick(): void {
    const ctx = this.e.ctx;
    if (!ctx || !this.def || !this.layer) return;
    const now = ctx.currentTime;
    const horizon = now + 0.3;
    const d = this.def;
    const inst = this.e.inst;
    const dest = this.layer;
    // évite les rafales après une suspension
    if (this.nextChord < now - 1) this.nextChord = now + 0.1;
    if (this.nextBell < now - 1) this.nextBell = now + 0.5;
    if (this.nextArp < now - 1) this.nextArp = now + 0.1;
    if (this.nextPulse < now - 1) this.nextPulse = now + 0.1;

    while (this.nextChord < horizon) {
      const ch = d.chords[this.chordIdx % d.chords.length];
      const bass = d.bass[this.chordIdx % d.bass.length];
      const t = this.nextChord;
      const cut = d.padCut * (1 + this.intensity * 1.2);
      inst.pad(ch.map(midi), t, d.chordDur, { gain: d.padGain * (1 + this.intensity * 0.3), cutoff: cut, attack: 3.5, release: 5, dest, reed: d.reed });
      inst.sub(midi(bass), t, d.chordDur + 3, 0.075 + this.intensity * 0.03, dest);
      this.chordIdx++;
      this.nextChord += d.chordDur;
    }
    while (this.nextBell < horizon) {
      const t = this.nextBell;
      const n = d.scale[Math.floor(Math.random() * d.scale.length)];
      const soft = Math.random() < 0.55;
      inst.bell(midi(n), t, {
        gain: d.bellGain * (0.6 + Math.random() * 0.5),
        ratio: soft ? 2.0 : 3.5,
        index: soft ? 0.6 : 1.1,
        decay: soft ? 2.6 : 4,
        pan: (Math.random() - 0.5) * 0.8,
        dest,
      });
      if (Math.random() < 0.35) {
        const n2 = d.scale[Math.min(d.scale.length - 1, d.scale.indexOf(n) + 2)];
        inst.bell(midi(n2), t + 0.32, { gain: d.bellGain * 0.6, ratio: 2, index: 0.5, decay: 2.4, pan: (Math.random() - 0.5) * 0.8, dest });
      }
      const [a, b] = d.bellEvery;
      this.nextBell += a + Math.random() * (b - a) * (1 - this.intensity * 0.5);
    }
    // Arpège (apparaît avec l'intensité)
    if (d.arpBpm > 0) {
      const step = 60 / d.arpBpm / 2;
      while (this.nextArp < horizon) {
        const t = this.nextArp;
        if (this.intensity > 0.2) {
          const ch = d.chords[(this.chordIdx + d.chords.length - 1) % d.chords.length];
          const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
          const idx = pattern[this.arpStep % pattern.length] % ch.length;
          const note = ch[idx] + 12 + (this.arpStep % 16 >= 8 && this.intensity > 0.6 ? 12 : 0);
          const g = 0.028 * Math.min(1, (this.intensity - 0.2) / 0.5);
          inst.glass(midi(note), t, { gain: g, decay: 1.3, pan: this.arpStep % 2 ? 0.25 : -0.25, delay: 0.3, dest });
        }
        this.arpStep++;
        this.nextArp += step;
      }
    }
    // Pulsation grave (chapitre III)
    if (this.scene === 'vanishing') {
      const beat = 60 / d.arpBpm;
      while (this.nextPulse < horizon) {
        if (this.intensity > 0.4) {
          const g = 0.12 * Math.min(1, (this.intensity - 0.4) / 0.4);
          inst.timpani(midi(33), this.nextPulse, g, dest);
        }
        this.nextPulse += beat;
      }
    }
  }

  /**
   * Finale scripté, synchronisé avec l'image : renvoie l'heure audio du temps 0.
   * Ré majeur — retour à la tonalité du Seuil.
   */
  playFinale(delay = 0.05): number {
    const ctx = this.e.ctx;
    if (!ctx) return -1;
    this.setScene('silence');
    const layer = ctx.createGain();
    layer.connect(this.e.musicBus);
    const t0 = ctx.currentTime + delay;
    this.finaleStart = t0;
    this.finaleScheduled = true;
    const B = this.beat;
    const inst = this.e.inst;
    const at = (beat: number) => t0 + beat * B;
    const D = [50, 57, 62, 66, 69, 74];
    const Bm = [47, 54, 59, 62, 66, 71];
    const G = [43, 50, 55, 59, 62, 66, 69];
    const A = [45, 52, 57, 61, 64, 69];
    const prog = [D, Bm, G, A];
    // Ouverture : impact et cascade de cloches.
    inst.boom(at(0), 0.6, 46);
    inst.timpani(midi(38), at(0), 0.35, layer);
    [86, 81, 78, 76, 74, 69].forEach((n, i) => inst.bell(midi(n), at(0) + i * 0.09, { gain: 0.05, ratio: 3.5, index: 1, decay: 5, pan: (i % 2 ? 0.4 : -0.4), dest: layer }));
    // 8 mesures de montée.
    for (let bar = 0; bar < 8; bar++) {
      const ch = prog[Math.floor(bar / 2) % 4];
      const b0 = bar * 4;
      if (bar % 2 === 0) inst.pad(ch.map(midi), at(b0), B * 8, { gain: 0.07 + bar * 0.008, cutoff: 900 + bar * 260, attack: 1.2, release: 3, dest: layer });
      inst.sub(midi(ch[0] - 12), at(b0), B * 4.2, 0.09, layer);
      for (let k = 0; k < 4; k++) inst.timpani(midi(ch[0] - 12), at(b0 + k), k === 0 ? 0.22 : 0.08 + bar * 0.012, layer);
      const sixteenths = bar < 2 ? 4 : bar < 5 ? 8 : 16;
      for (let s = 0; s < sixteenths; s++) {
        const note = ch[(s * 3 + bar) % ch.length] + 24 - (s % 4 === 0 ? 12 : 0);
        inst.glass(midi(note), at(b0) + (s * 4 * B) / sixteenths, { gain: 0.022 + bar * 0.003, decay: 1.1, pan: s % 2 ? 0.3 : -0.3, delay: 0.2, dest: layer });
      }
    }
    inst.riser(at(24), B * 8, 0.12, 250, 7000, layer);
    // Sommet : temps 32.
    const top = [38, 50, 57, 62, 66, 69, 74, 78];
    inst.boom(at(32), 0.75, 40);
    inst.timpani(midi(38), at(32), 0.45, layer);
    inst.pad(top.map(midi), at(32), B * 16, { gain: 0.14, cutoff: 2600, attack: 0.15, release: 9, dest: layer });
    [98, 93, 90, 86, 81, 78, 74].forEach((n, i) => inst.bell(midi(n), at(32) + 0.05 + i * 0.07, { gain: 0.045, ratio: 3.5, index: 1.2, decay: 6, pan: (i / 6 - 0.5) * 1.2, dest: layer }));
    inst.sub(midi(26), at(32), B * 18, 0.14, layer);
    // Résolution vers l'épilogue.
    const coda = [
      [50, 57, 61, 64, 66],
      [43, 50, 54, 59, 61, 64],
    ];
    inst.pad(coda[0].map(midi), at(44), B * 12, { gain: 0.07, cutoff: 1300, attack: 4, release: 7, dest: layer });
    inst.pad(coda[1].map(midi), at(54), B * 14, { gain: 0.06, cutoff: 1100, attack: 5, release: 8, dest: layer });
    [74, 78, 81, 85, 88].forEach((n, i) => inst.bell(midi(n), at(36 + i * 3), { gain: 0.03, ratio: 2, index: 0.5, decay: 4, pan: (i % 2 ? 0.3 : -0.3), dest: layer }));
    window.setTimeout(() => layer.disconnect(), (delay + B * 80) * 1000);
    return t0;
  }

  /** Temps (en battements) écoulé depuis le début du finale. */
  finaleBeat(): number {
    const ctx = this.e.ctx;
    if (!ctx || !this.finaleScheduled) return -1;
    return (ctx.currentTime - this.finaleStart) / this.beat;
  }
}
