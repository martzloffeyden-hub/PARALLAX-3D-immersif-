import * as THREE from 'three';
import type { GravityFrame, Player } from '../player/Player';
import { clamp, smoothstep } from '../util/math';

export interface AnamorphosisOptions {
  name: string;
  frame: GravityFrame;
  /** Point au sol (pieds) du point de vue, dans le repère du référentiel. */
  foot: THREE.Vector3;
  /** Centre de la figure (point regardé). */
  focus: THREE.Vector3;
  eyeHeight?: number;
  /** Échelle de décroissance de l'alignement en position (m). */
  sigma?: number;
  /** Rayon d'audibilité de l'accord (m). */
  hearRadius?: number;
  /** Tolérances de verrouillage. */
  lockDist?: number;
  lockAngleDeg?: number;
}

const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();

/**
 * Une figure anamorphique : un point de vue exact, une figure regardée,
 * et la mesure continue de l'alignement du regard du joueur.
 */
export class Anamorphosis {
  readonly name: string;
  readonly frame: GravityFrame;
  readonly foot: THREE.Vector3;
  readonly focus: THREE.Vector3;
  readonly eye: THREE.Vector3;
  readonly sigma: number;
  readonly hearRadius: number;
  readonly lockDist: number;
  readonly lockCos: number;
  /** Alignement combiné position × regard (0..1). */
  alignment = 0;
  posAlign = 0;
  lookAlign = 0;
  /** Proximité (0..1) pour le volume de l'accord. */
  proximity = 0;
  distance = Infinity;
  state: 'dormant' | 'idle' | 'locking' | 'locked' = 'idle';
  /** Appelé quand le regard se fixe (fin du glissement magnétique). */
  onLock: (() => void) | null = null;

  constructor(o: AnamorphosisOptions) {
    this.name = o.name;
    this.frame = o.frame;
    this.foot = o.foot.clone();
    this.focus = o.focus.clone();
    this.eye = o.foot.clone().add(new THREE.Vector3(0, o.eyeHeight ?? 1.62, 0));
    this.sigma = o.sigma ?? 2.6;
    this.hearRadius = o.hearRadius ?? 32;
    this.lockDist = o.lockDist ?? 1.1;
    this.lockCos = Math.cos(((o.lockAngleDeg ?? 24) * Math.PI) / 180);
  }

  get active(): boolean {
    return this.state === 'idle';
  }

  update(player: Player): void {
    if (this.state !== 'idle' || player.frame !== this.frame) {
      this.alignment = this.state === 'locked' ? 1 : this.state === 'locking' ? Math.max(this.alignment, 0.9) : 0;
      this.proximity = this.state === 'dormant' ? 0 : this.proximity;
      return;
    }
    _eye.copy(player.pos);
    _eye.y += player.eyeHeight;
    const d = _eye.distanceTo(this.eye);
    this.distance = d;
    this.posAlign = Math.exp(-(d * d) / (this.sigma * this.sigma));
    player.localForward(_fwd);
    _to.copy(this.focus).sub(_eye).normalize();
    const c = _fwd.dot(_to);
    this.lookAlign = smoothstep(Math.cos((50 * Math.PI) / 180), Math.cos((4 * Math.PI) / 180), c);
    this.alignment = this.posAlign * this.lookAlign;
    const df = Math.min(d, _eye.distanceTo(this.focus));
    this.proximity = clamp(1 - df / this.hearRadius);
  }

  /** Le joueur est-il assez proche et regarde-t-il assez dans l'axe pour verrouiller ? */
  canLock(player: Player): boolean {
    if (this.state !== 'idle' || player.frame !== this.frame) return false;
    if (this.distance > this.lockDist) return false;
    _eye.copy(player.pos);
    _eye.y += player.eyeHeight;
    player.localForward(_fwd);
    _to.copy(this.focus).sub(_eye).normalize();
    return _fwd.dot(_to) >= this.lockCos;
  }

  /** Orientation exacte (lacet, tangage) du point de vue vers la figure. */
  viewAngles(): { yaw: number; pitch: number } {
    _to.copy(this.focus).sub(this.eye).normalize();
    return { yaw: Math.atan2(-_to.x, -_to.z), pitch: Math.asin(clamp(_to.y, -1, 1)) };
  }
}
