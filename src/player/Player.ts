import * as THREE from 'three';
import { ColliderSet, type Surface } from './Colliders';
import type { Input } from './Input';
import { clamp, damp, ease, lerp } from '../util/math';

/**
 * Un référentiel de gravité : un repère (objet 3D) dans lequel « le bas » est -Y local,
 * et le jeu de collisions associé, exprimé dans ce repère.
 */
export class GravityFrame {
  readonly colliders = new ColliderSet();
  /** Altitude locale sous laquelle on considère que le joueur est tombé. */
  killY = -40;
  constructor(
    readonly name: string,
    readonly object: THREE.Object3D,
  ) {}
  localToWorld(v: THREE.Vector3): THREE.Vector3 {
    this.object.updateWorldMatrix(true, false);
    return v.applyMatrix4(this.object.matrixWorld);
  }
  worldToLocal(v: THREE.Vector3): THREE.Vector3 {
    this.object.updateWorldMatrix(true, false);
    return this.object.worldToLocal(v);
  }
  quaternion(out: THREE.Quaternion): THREE.Quaternion {
    this.object.updateWorldMatrix(true, false);
    return this.object.getWorldQuaternion(out);
  }
}

export interface PlayerTuning {
  walkSpeed: number;
  runSpeed: number;
  observeSpeed: number;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

interface Glide {
  t: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  yaw0: number;
  yaw1: number;
  pitch0: number;
  pitch1: number;
  done?: () => void;
}

interface FrameShift {
  t: number;
  dur: number;
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  /** Décalage monde maximal à mi-parcours (la caméra s'écarte pour que la bascule se lise). */
  arc: THREE.Vector3 | null;
  done?: () => void;
}

export class Player {
  frame: GravityFrame;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  readonly eyeHeight = 1.62;
  readonly radius = 0.32;
  readonly stepUp = 0.45;
  grounded = false;
  groundSurface: Surface = 'stone';
  private eyeY = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private landDip = 0;
  private landVel = 0;
  private lastStep = 0;
  private fallTime = 0;
  /** Gel des commandes (cinématiques, menus). */
  frozen = false;
  /** Coefficient appliqué à la vitesse (ex. ralenti pendant l'observation). */
  observing = false;
  fovOffset = 0;
  private fovKick = 0;
  tuning: PlayerTuning = { walkSpeed: 3.6, runSpeed: 6.4, observeSpeed: 1.3 };
  sensitivity = 1;
  invertY = false;
  headBob = true;
  reducedMotion = false;
  private lookSmoothX = 0;
  private lookSmoothY = 0;
  private glide: Glide | null = null;
  private shift: FrameShift | null = null;
  readonly lastSafe = { frame: null as GravityFrame | null, pos: new THREE.Vector3(), yaw: 0 };
  private safeTimer = 0;
  /** Distance parcourue au sol (pour les statistiques/tests). */
  distance = 0;

  onFootstep: ((surface: Surface, intensity: number) => void) | null = null;
  onLand: ((surface: Surface, impact: number) => void) | null = null;
  onFall: (() => void) | null = null;

  constructor(frame: GravityFrame) {
    this.frame = frame;
  }

  /** Place le joueur (pieds) dans un référentiel. */
  teleport(frame: GravityFrame, x: number, y: number, z: number, yaw: number, pitch = 0): void {
    this.frame = frame;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeY = y + this.eyeHeight;
    this.grounded = false;
    this.glide = null;
    this.shift = null;
    this.fallTime = 0;
    this.lastSafe.frame = frame;
    this.lastSafe.pos.set(x, y, z);
    this.lastSafe.yaw = yaw;
    this.snapToGround();
  }

  private snapToGround(): void {
    const g = this.frame.colliders.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5, 0.6, this.radius * 0.6);
    if (g) {
      this.pos.y = g.y;
      this.grounded = true;
      this.groundSurface = g.surface;
      this.eyeY = g.y + this.eyeHeight;
    }
  }

  /** Glissement scripté (magnétisme du point de vue). */
  glideTo(x: number, y: number, z: number, yaw: number, pitch: number, dur: number, done?: () => void): void {
    // Choisit le chemin angulaire le plus court.
    let y1 = yaw;
    while (y1 - this.yaw > Math.PI) y1 -= Math.PI * 2;
    while (y1 - this.yaw < -Math.PI) y1 += Math.PI * 2;
    this.glide = {
      t: 0,
      dur,
      from: this.pos.clone(),
      to: new THREE.Vector3(x, y, z),
      yaw0: this.yaw,
      yaw1: y1,
      pitch0: this.pitch,
      pitch1: pitch,
      done,
    };
    this.vel.set(0, 0, 0);
  }

  get gliding(): boolean {
    return this.glide !== null;
  }

  get shifting(): boolean {
    return this.shift !== null;
  }

  /**
   * Bascule vers un autre référentiel de gravité. La caméra interpole
   * son orientation monde de l'ancienne vers la nouvelle.
   */
  shiftFrame(frame: GravityFrame, x: number, y: number, z: number, yaw: number, pitch: number, dur: number, done?: () => void, arc?: THREE.Vector3): void {
    const fromPos = new THREE.Vector3();
    const fromQuat = new THREE.Quaternion();
    this.computeWorldPose(fromPos, fromQuat);
    this.frame = frame;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeY = y + this.eyeHeight;
    this.glide = null;
    this.shift = { t: 0, dur, fromPos, fromQuat, arc: arc ? arc.clone() : null, done };
    this.snapToGround();
  }

  update(dt: number, input: Input | null): void {
    // --- Glissement scripté
    if (this.glide) {
      const g = this.glide;
      g.t += dt;
      const k = ease.inOutCubic(clamp(g.t / g.dur));
      this.pos.lerpVectors(g.from, g.to, k);
      this.yaw = lerp(g.yaw0, g.yaw1, k);
      this.pitch = lerp(g.pitch0, g.pitch1, k);
      this.eyeY = this.pos.y + this.eyeHeight;
      this.bobAmp = damp(this.bobAmp, 0, 6, dt);
      this.roll = damp(this.roll, 0, 6, dt);
      if (g.t >= g.dur) {
        this.glide = null;
        g.done?.();
      }
      this.updateFov(dt, false);
      return;
    }
    if (this.shift) {
      this.shift.t += dt;
      if (this.shift.t >= this.shift.dur) {
        const done = this.shift.done;
        this.shift = null;
        done?.();
      }
    }

    const active = !this.frozen && input !== null && !this.shift;
    // --- Regard
    if (active) {
      const { dx, dy } = input!.consumeLook();
      const s = 0.0021 * this.sensitivity;
      // Lissage très court : supprime le crénelage de la souris sans latence perceptible.
      this.lookSmoothX = lerp(this.lookSmoothX, dx, 0.75);
      this.lookSmoothY = lerp(this.lookSmoothY, dy, 0.75);
      const obsMul = this.observing ? 0.55 : 1;
      this.yaw -= this.lookSmoothX * s * obsMul;
      this.pitch -= this.lookSmoothY * s * obsMul * (this.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.45);
    } else if (input) {
      input.consumeLook();
    }

    // --- Déplacement
    const mv = active ? input!.moveVector() : { x: 0, y: 0 };
    const running = active && input!.running() && !this.observing;
    const speed = this.observing ? this.tuning.observeSpeed : running ? this.tuning.runSpeed : this.tuning.walkSpeed;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // avant = -Z local tourné de yaw ; droite = +X tourné de yaw
    const tx = (mv.x * cy - mv.y * sy) * speed;
    const tz = (-mv.x * sy - mv.y * cy) * speed;
    const accel = mv.x !== 0 || mv.y !== 0 ? 9 : 11;
    const airCtl = this.grounded ? 1 : 0.25;
    this.vel.x = damp(this.vel.x, tx, accel * airCtl, dt);
    this.vel.z = damp(this.vel.z, tz, accel * airCtl, dt);
    if (!this.grounded) this.vel.y -= 24 * dt;

    const cs = this.frame.colliders;
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    const steps = Math.max(1, Math.ceil((hspeed * dt) / 0.2));
    const sdt = dt / steps;
    const wasGrounded = this.grounded;
    let fallSpeed = 0;
    const p2 = { x: 0, z: 0 };
    for (let i = 0; i < steps; i++) {
      p2.x = this.pos.x + this.vel.x * sdt;
      p2.z = this.pos.z + this.vel.z * sdt;
      cs.resolve(p2, this.radius, this.pos.y, this.pos.y + 1.8, this.grounded ? this.stepUp : 0.05);
      const moved = Math.hypot(p2.x - this.pos.x, p2.z - this.pos.z);
      this.pos.x = p2.x;
      this.pos.z = p2.z;
      if (this.grounded) this.distance += moved;
      const g = cs.groundAt(this.pos.x, this.pos.z, this.pos.y, this.grounded ? this.stepUp : 0.05, this.radius * 0.55);
      if (this.grounded) {
        if (g && g.y >= this.pos.y - 0.55) {
          this.pos.y = g.y;
          this.groundSurface = g.surface;
          this.vel.y = 0;
        } else {
          this.grounded = false;
          this.vel.y = Math.min(this.vel.y, 0);
        }
      } else {
        const ny = this.pos.y + this.vel.y * sdt;
        if (g && this.vel.y <= 0 && ny <= g.y) {
          fallSpeed = -this.vel.y;
          this.pos.y = g.y;
          this.vel.y = 0;
          this.grounded = true;
          this.groundSurface = g.surface;
        } else {
          this.pos.y = ny;
        }
      }
    }
    // Rebord circulaire doux (zones ouvertes).
    if (cs.bounds) {
      const b = cs.bounds;
      const dx = this.pos.x - b.x;
      const dz = this.pos.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > b.r) {
        this.pos.x = b.x + (dx / d) * b.r;
        this.pos.z = b.z + (dz / d) * b.r;
      }
    }

    if (!wasGrounded && this.grounded) {
      const impact = clamp((fallSpeed - 2) / 10);
      if (fallSpeed > 2.5) {
        this.landVel = -impact * 2.2;
        this.onLand?.(this.groundSurface, impact);
      }
      this.fallTime = 0;
    }
    if (!this.grounded) {
      this.fallTime += dt;
      if (this.pos.y < this.frame.killY) {
        this.fallTime = 0;
        this.onFall?.();
      }
    }

    // Point sûr pour la réapparition.
    this.safeTimer += dt;
    if (this.grounded && this.safeTimer > 0.5) {
      this.safeTimer = 0;
      const g = cs.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1, 0.2, -this.radius);
      if (g && g.safe) {
        this.lastSafe.frame = this.frame;
        this.lastSafe.pos.copy(this.pos);
        this.lastSafe.yaw = this.yaw;
      }
    }

    // --- Hauteur des yeux lissée (escaliers) + atterrissage amorti
    const targetEye = this.pos.y + this.eyeHeight;
    if (this.grounded) this.eyeY = damp(this.eyeY, targetEye, 16, dt);
    else this.eyeY = targetEye;
    if (Math.abs(this.eyeY - targetEye) > 0.6) this.eyeY = targetEye + Math.sign(this.eyeY - targetEye) * 0.6;
    // ressort pour la plongée d'atterrissage
    this.landVel += (-this.landDip * 90 - this.landVel * 14) * dt;
    this.landDip += this.landVel * dt;

    // --- Balancement de tête et pas
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const moving = this.grounded && hs > 0.4;
    this.bobAmp = damp(this.bobAmp, moving ? clamp(hs / this.tuning.walkSpeed, 0, 1.6) : 0, 6, dt);
    if (this.grounded && hs > 0.15) {
      const stepsPerSec = 1.25 + hs * 0.33;
      this.bobPhase += dt * stepsPerSec * Math.PI;
      const step = Math.floor(this.bobPhase / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        this.onFootstep?.(this.groundSurface, clamp(hs / this.tuning.runSpeed + 0.25, 0.2, 1));
      }
    }
    const strafe = active ? mv.x : 0;
    this.roll = damp(this.roll, this.reducedMotion || !this.headBob ? 0 : -strafe * 0.012, 5, dt);
    this.updateFov(dt, running && hs > this.tuning.walkSpeed + 0.5);
  }

  private updateFov(dt: number, running: boolean): void {
    const target = (running ? 5 : 0) + (this.observing ? -9 : 0);
    this.fovKick = damp(this.fovKick, this.reducedMotion ? Math.min(0, target) : target, 4, dt);
    this.fovOffset = this.fovKick;
  }

  /** Pose locale de la caméra (dans le référentiel). */
  computeLocalPose(outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    const bob = this.headBob && !this.reducedMotion ? this.bobAmp : 0;
    const vb = (Math.abs(Math.sin(this.bobPhase)) - 0.5) * 0.045 * bob;
    const lat = Math.sin(this.bobPhase) * 0.025 * bob;
    outPos.set(this.pos.x, this.eyeY + vb + this.landDip * 0.12, this.pos.z);
    outPos.x += Math.cos(this.yaw) * lat;
    outPos.z += -Math.sin(this.yaw) * lat;
    _e.set(this.pitch + vb * 0.12, this.yaw, this.roll + lat * 0.25, 'YXZ');
    outQuat.setFromEuler(_e);
  }

  /** Pose monde de la caméra, en tenant compte du référentiel et d'une bascule en cours. */
  computeWorldPose(outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    this.computeLocalPose(outPos, outQuat);
    this.frame.localToWorld(outPos);
    this.frame.quaternion(_q);
    outQuat.premultiply(_q);
    if (this.shift) {
      const raw = clamp(this.shift.t / this.shift.dur);
      const k = ease.inOutCubic(raw);
      outPos.lerpVectors(this.shift.fromPos, _v.copy(outPos), k);
      if (this.shift.arc) outPos.addScaledVector(this.shift.arc, Math.sin(Math.PI * ease.inOutSine(raw)));
      _q2.copy(this.shift.fromQuat).slerp(outQuat, k);
      outQuat.copy(_q2);
    }
  }

  /** Direction du regard dans le référentiel local. */
  localForward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  respawnAtSafe(): void {
    const s = this.lastSafe;
    if (!s.frame) return;
    this.teleport(s.frame, s.pos.x, s.pos.y, s.pos.z, s.yaw, 0);
  }
}
