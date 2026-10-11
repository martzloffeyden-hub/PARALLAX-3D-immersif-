import * as THREE from 'three';
import { clamp, damp, ease, smoothNoise1 } from '../util/math';

export interface CamPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
}

export const makePose = (): CamPose => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 70 });

/** Plan de caméra scripté : renvoie la pose pour un temps donné. */
export type Shot = (t: number, out: CamPose) => void;

const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/** Fixe `out.quat` pour regarder de `from` vers `to`. */
export function lookQuat(out: THREE.Quaternion, from: THREE.Vector3, to: THREE.Vector3, up = _up, roll = 0): THREE.Quaternion {
  _m.lookAt(from, to, up);
  out.setFromRotationMatrix(_m);
  if (roll) out.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  return out;
}

/**
 * Le réalisateur combine la caméra du joueur et les plans cinématiques,
 * avec des fondus de pose, des secousses et des variations de focale.
 */
export class Director {
  readonly camera: THREE.PerspectiveCamera;
  private shot: Shot | null = null;
  private shotTime = 0;
  private blend = 0;
  private blendTarget = 0;
  private blendDur = 1;
  private blendFrom = 0;
  private blendT = 1;
  private readonly cinePose = makePose();
  private readonly outPose = makePose();
  private shakeAmt = 0;
  private shakeTime = 0;
  private shakeDur = 0;
  private shakeClock = 0;
  reducedMotion = false;
  /** Décalage de focale additionnel (effets). */
  fovPulse = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.08, 2500);
  }

  get active(): boolean {
    return this.shot !== null || this.blend > 0.0001;
  }

  get cineWeight(): number {
    return this.blend;
  }

  /** Démarre un plan scripté, avec un fondu depuis la caméra courante. */
  play(shot: Shot, blendIn = 1.2): void {
    this.shot = shot;
    this.shotTime = 0;
    this.blendFrom = this.blend;
    this.blendTarget = 1;
    this.blendDur = Math.max(0.001, blendIn);
    this.blendT = 0;
  }

  /** Rend la main au joueur, avec un fondu. */
  release(blendOut = 1.2): void {
    this.blendFrom = this.blend;
    this.blendTarget = 0;
    this.blendDur = Math.max(0.001, blendOut);
    this.blendT = 0;
  }

  shake(amount: number, duration: number): void {
    if (this.reducedMotion) amount *= 0.25;
    this.shakeAmt = Math.max(this.shakeAmt * (1 - this.shakeTime / Math.max(this.shakeDur, 1e-3)), amount);
    this.shakeDur = duration;
    this.shakeTime = 0;
  }

  update(dt: number, playerPose: CamPose): void {
    if (this.shot) {
      this.shotTime += dt;
      this.shot(this.shotTime, this.cinePose);
    }
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      this.blend = this.blendFrom + (this.blendTarget - this.blendFrom) * ease.inOutCubic(this.blendT);
      if (this.blendT >= 1 && this.blendTarget === 0) this.shot = null;
    }
    const o = this.outPose;
    const b = this.shot ? this.blend : 0;
    o.pos.copy(playerPose.pos).lerp(this.cinePose.pos, b);
    o.quat.copy(playerPose.quat).slerp(this.cinePose.quat, b);
    o.fov = playerPose.fov + (this.cinePose.fov - playerPose.fov) * b;

    // Secousse (bruit lisse, décroissance quadratique).
    this.shakeClock += dt;
    if (this.shakeTime < this.shakeDur) {
      this.shakeTime += dt;
      const k = 1 - clamp(this.shakeTime / this.shakeDur);
      const a = this.shakeAmt * k * k;
      const t = this.shakeClock * 9;
      o.pos.x += smoothNoise1(t, 1) * 0.06 * a;
      o.pos.y += smoothNoise1(t, 2) * 0.05 * a;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(smoothNoise1(t, 3) * 0.012 * a, smoothNoise1(t, 4) * 0.012 * a, smoothNoise1(t, 5) * 0.02 * a),
      );
      o.quat.multiply(q);
    }
    this.fovPulse = damp(this.fovPulse, 0, 3, dt);

    const cam = this.camera;
    cam.position.copy(o.pos);
    cam.quaternion.copy(o.quat);
    const fov = o.fov + this.fovPulse;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
