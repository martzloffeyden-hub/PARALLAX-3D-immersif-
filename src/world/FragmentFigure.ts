import * as THREE from 'three';
import { Rng, clamp, ease } from '../util/math';

// Anamorphose d'éclats : chaque pièce est placée sur la ligne de visée qui
// relie le point de vue V à sa position finale, à une distance multipliée par k
// (et agrandie d'autant). Depuis V, l'image est identique à la figure assemblée ;
// de partout ailleurs, ce n'est qu'un nuage de pierres en suspension.

export interface PieceSpec {
  /** Index du type de géométrie / matériau. */
  type: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface Piece extends PieceSpec {
  k: number;
  index: number;
  phase: number;
  axis: THREE.Vector3;
  wob: THREE.Vector3;
  start: number;
  done: boolean;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();

export interface FigureOptions {
  /** Point de vue (œil) dans le repère du groupe. */
  eye: THREE.Vector3;
  kMin: number;
  kMax: number;
  seed?: number;
  /** Amplitude de la flottaison au repos. */
  wobble?: number;
  /** Refuse un placement dispersé (ex. à l'intérieur d'une île). */
  reject?: (p: THREE.Vector3, size: number) => boolean;
}

export class FragmentFigure {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  private pieces: Piece[] = [];
  private eye: THREE.Vector3;
  private time = 0;
  /** Temps écoulé depuis le début de l'assemblage (-1 = non commencé). */
  assembleT = -1;
  assembled = false;
  private wobble: number;
  onPieceLanded: ((index: number, worldPos: THREE.Vector3, order: number) => void) | null = null;
  onComplete: (() => void) | null = null;
  private landed = 0;
  /** Facteur d'apaisement (0..1) : la figure se calme quand on s'aligne. */
  calm = 0;

  constructor(
    specs: PieceSpec[],
    types: { geometry: THREE.BufferGeometry; material: THREE.Material; castShadow?: boolean }[],
    o: FigureOptions,
  ) {
    this.eye = o.eye.clone();
    this.wobble = o.wobble ?? 0.35;
    const rng = new Rng(o.seed ?? 3);
    const counts = types.map(() => 0);
    for (const s of specs) counts[s.type]++;
    types.forEach((t, i) => {
      const im = new THREE.InstancedMesh(t.geometry, t.material, Math.max(1, counts[i]));
      im.count = counts[i];
      im.castShadow = t.castShadow ?? true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(im);
      this.group.add(im);
    });
    const idx = types.map(() => 0);
    for (const s of specs) {
      let k = 1;
      for (let tries = 0; tries < 30; tries++) {
        k = rng.next() < 0.5 ? THREE.MathUtils.lerp(o.kMin, 1, rng.next() * 0.85) : THREE.MathUtils.lerp(1.15, o.kMax, rng.next());
        _p.copy(s.pos).sub(this.eye).multiplyScalar(k).add(this.eye);
        if (!o.reject || !o.reject(_p, Math.max(s.scale.x, s.scale.y, s.scale.z) * k)) break;
      }
      this.pieces.push({
        ...s,
        k,
        index: idx[s.type]++,
        phase: rng.next() * Math.PI * 2,
        axis: new THREE.Vector3(rng.gauss(), rng.gauss(), rng.gauss()).normalize(),
        wob: new THREE.Vector3(rng.gauss(), rng.gauss() * 0.6, rng.gauss()).normalize(),
        start: 0,
        done: false,
      });
    }
    this.update(0);
  }

  get count(): number {
    return this.pieces.length;
  }

  /**
   * Lance l'assemblage. `order` trie les pièces (ex. du plus proche au plus lointain),
   * `interval` est l'écart entre deux départs, `dur` la durée de vol d'une pièce.
   */
  assemble(order: (a: PieceSpec, b: PieceSpec) => number, interval: number, dur: number): void {
    const sorted = [...this.pieces].sort(order);
    sorted.forEach((p, i) => (p.start = i * interval));
    this.flight = dur;
    this.assembleT = 0;
  }

  private flight = 1.6;

  /** Durée totale de l'assemblage. */
  get totalDuration(): number {
    let m = 0;
    for (const p of this.pieces) m = Math.max(m, p.start);
    return m + this.flight;
  }

  /** Assemble instantanément (reprise, tests). */
  snapAssembled(): void {
    for (const p of this.pieces) p.done = true;
    this.assembleT = 1e6;
    this.assembled = true;
    this.update(0);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.assembleT >= 0) this.assembleT += dt;
    const calm = this.calm;
    for (const p of this.pieces) {
      let kk = p.k;
      let wobAmp = this.wobble * (1 - calm);
      if (this.assembleT >= 0) {
        const tt = clamp((this.assembleT - p.start) / this.flight);
        const e = ease.inOutCubic(tt);
        kk = p.k + (1 - p.k) * e;
        wobAmp *= 1 - Math.min(1, tt * 2.5);
        if (tt >= 1 && !p.done) {
          p.done = true;
          this.landed++;
          _p.copy(p.pos);
          this.group.localToWorld(_p);
          this.onPieceLanded?.(p.type, _p.clone(), this.landed - 1);
          if (this.landed === this.pieces.length) {
            this.assembled = true;
            this.onComplete?.();
          }
        }
      }
      _p.copy(p.pos).sub(this.eye).multiplyScalar(kk).add(this.eye);
      _s.copy(p.scale).multiplyScalar(kk);
      _q.copy(p.quat);
      if (wobAmp > 1e-4) {
        const w = Math.sin(this.time * 0.6 + p.phase);
        _p.addScaledVector(p.wob, w * wobAmp * kk);
        _qw.setFromAxisAngle(p.axis, Math.sin(this.time * 0.45 + p.phase * 1.7) * 0.12 * (wobAmp / this.wobble));
        _q.premultiply(_qw);
      }
      _m.compose(_p, _q, _s);
      this.meshes[p.type].setMatrixAt(p.index, _m);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  /** Position finale (repère du groupe) d'une pièce assemblée — utile pour les collisions. */
  dispose(): void {
    for (const m of this.meshes) m.dispose();
  }
}
