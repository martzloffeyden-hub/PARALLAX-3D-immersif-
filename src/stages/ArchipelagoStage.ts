import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Stage, type StageContext, type StageHost } from './Stage';
import { Atmosphere, hdr, type AtmosphereParams } from '../render/Atmosphere';
import { Sky } from '../world/Sky';
import { Builder, withWhite } from '../world/Builder';
import { extendSurface } from '../render/Surface';
import { Anamorphosis } from '../world/Anamorphosis';
import { FragmentFigure, type PieceSpec } from '../world/FragmentFigure';
import { CloudSea } from '../world/CloudSea';
import { Emblem } from '../world/Emblem';
import { Portal } from '../world/Portal';
import { Motes, DustBursts } from '../world/Particles';
import { GravityFrame } from '../player/Player';
import type { BoxCollider } from '../player/Colliders';
import type { TuningVoice } from '../audio/AudioEngine';
import { midi } from '../audio/AudioEngine';
import { Sequence } from '../util/Sequence';
import { Rng, clamp, ease, lerp } from '../util/math';
import { lookQuat } from '../app/Director';
import type { Graphics } from '../render/Graphics';
import { GATE_PORTAL_POS, GATE_PORTAL_R } from './ThresholdStage';

const PORTAL_R = GATE_PORTAL_R;
const ARRIVAL = new THREE.Vector3(0, PORTAL_R - 1.2, 9);
const SUMMIT_Y = 50;
const NIGHT_GATE = new THREE.Vector3(0, SUMMIT_Y + PORTAL_R - 1.2, -122);
/** Point de vue de la Porte de la Nuit : un angle du sommet, hors de l'axe d'arrivée. */
const GATE_VIEW = new THREE.Vector3(7.6, SUMMIT_Y, -86);

type Phase = 'bridge' | 'bridgeEvent' | 'island' | 'summit' | 'gateEvent' | 'night' | 'gone';

/** Boîte englobante simple pour refuser les placements dispersés. */
interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** Chapitre II — L'Archipel : des îles de pierre au-dessus d'une mer de nuages, à l'heure bleue. */
export class ArchipelagoStage extends Stage {
  readonly id = 'archipelago';
  readonly chapter = 2;
  /** Point d'arrivée du portail du Seuil (repère destination). */
  readonly arrival = { pos: ARRIVAL.clone(), yaw: 0 };
  private clouds!: CloudSea;
  private bridge!: FragmentFigure;
  private gate!: FragmentFigure;
  private bridgeAnam!: Anamorphosis;
  private gateAnam!: Anamorphosis;
  private bridgeColliders: BoxCollider[] = [];
  private lightBridge!: THREE.InstancedMesh;
  private lightBridgeColliders: BoxCollider[] = [];
  private wallFrame!: GravityFrame;
  private ring!: Emblem;
  private backPortal!: Portal;
  portal!: Portal;
  private motes!: Motes;
  private dust!: DustBursts;
  private tuningBridge: TuningVoice | null = null;
  private tuningGate: TuningVoice | null = null;
  phase: Phase = 'bridge';
  private dayParams!: AtmosphereParams;
  private nightParams!: AtmosphereParams;
  private night = 0;
  private shiftCooldown = 0;
  private hintStep = 0;
  private phaseTime = 0;
  private backPortalTime = 0;
  private crossed = false;
  private floaters!: THREE.InstancedMesh;
  private lanternMat!: THREE.MeshStandardMaterial;
  private cloudDay!: { lit: THREE.Color; shade: THREE.Color; deep: THREE.Color };
  private wallHinted = false;
  private everOnWall = false;
  private gateHum: import('../audio/AudioEngine').LoopHandle | null = null;

  build(ctx: StageContext): void {
    this.ctx = ctx;
    const q = ctx.quality;
    const renderer = ctx.graphics.renderer;
    this.musicScene = 'archipelago';
    this.reverb = [4.5, 2.4, 0.95];
    this.card = ['Chapitre II', 'L’Archipel', 'Ce que l’on voit devient réel.'];
    this.next = 'vanishing';
    this.far = 3000;

    this.dayParams = {
      sunDir: new THREE.Vector3(-0.92, 0.04, -0.38).normalize(),
      sunColor: hdr(0xff8a5a, 1.2),
      zenith: hdr(0x0f2250, 0.38),
      mid: hdr(0x41558e, 0.55),
      horizon: hdr(0xe39a86, 0.62),
      ground: hdr(0x141c38, 0.35),
      shape: new THREE.Vector4(0.55, 2.0, 22, 0.15),
      sunGlow: new THREE.Vector4(0.12, 4, 0.8, 60),
      fog: new THREE.Vector4(0.0012, 0.01, -40, 0.9),
      fogTint: new THREE.Color(0.82, 0.86, 1.0),
      fogSun: 0.18,
    };
    this.nightParams = {
      sunDir: new THREE.Vector3(-0.92, -0.1, -0.38).normalize(),
      sunColor: hdr(0x5a6aa0, 0.5),
      zenith: hdr(0x03060f, 0.25),
      mid: hdr(0x0b1630, 0.3),
      horizon: hdr(0x23305a, 0.35),
      ground: hdr(0x050810, 0.2),
      shape: new THREE.Vector4(0.5, 2.0, 18, 0.2),
      sunGlow: new THREE.Vector4(0.05, 3, 0.1, 40),
      fog: new THREE.Vector4(0.0018, 0.012, -40, 0.95),
      fogTint: new THREE.Color(0.9, 0.95, 1.1),
      fogSun: 0.05,
    };
    this.atmosphere = new Atmosphere(this.dayParams);
    const atm = this.atmosphere;
    this.sky = new Sky(atm, ctx.textures.noise, { clouds: 0.22, cloudColor: hdr(0xffb7a0, 0.7), cloudScale: 0.6, sunDiskIntensity: 0, stars: 0.25, galaxy: 0.3 });
    this.scene.add(this.sky.mesh);
    this.cloudDay = { lit: hdr(0xffb8a0, 1.1), shade: hdr(0x46558a, 0.45), deep: hdr(0x0e1530, 0.25) };
    this.clouds = new CloudSea(atm, ctx.textures.noise, {
      top: -52,
      thick: 22,
      steps: q.cloudLayers >= 3 ? 6 : q.cloudLayers === 2 ? 5 : 3,
      cover: 0.3,
      ...this.cloudDay,
    });
    this.scene.add(this.clouds.mesh);

    // --- Matériaux
    const tex = ctx.textures;
    const stone = extendSurface(new THREE.MeshStandardMaterial({ color: 0xd8ccb8, roughness: 0.82, vertexColors: true }), {
      atmosphere: atm,
      textures: tex,
      stoneScale: 0.42,
      variation: 0.16,
      bump: 0.01,
      roughVar: 0.22,
      contactAO: { y: 0, height: 1.4, strength: 0.4 },
    });
    const under = extendSurface(new THREE.MeshStandardMaterial({ color: 0xa89a88, roughness: 0.9, vertexColors: true }), {
      atmosphere: atm,
      textures: tex,
      stoneScale: 0.25,
      variation: 0.2,
      bump: 0.01,
    });
    const verm = extendSurface(
      new THREE.MeshStandardMaterial({ color: 0xe4472f, roughness: 0.55, emissive: 0xe4472f, emissiveIntensity: 0.55, vertexColors: true }),
      { atmosphere: atm },
    );
    this.lanternMat = new THREE.MeshStandardMaterial({ color: 0xffc890, emissive: 0xff9a50, emissiveIntensity: 3.0, roughness: 0.4 });
    extendSurface(this.lanternMat, { atmosphere: atm });
    const bronze = extendSurface(new THREE.MeshStandardMaterial({ color: 0xa47a4a, roughness: 0.3, metalness: 1, vertexColors: true }), { atmosphere: atm });
    const mats = { stone, under, verm, lantern: this.lanternMat, bronze };

    const cs = this.mainFrame.colliders;
    this.mainFrame.killY = -45;
    const b = new Builder(cs, 41);
    const islandBoxes: AABB[] = [];
    const island = (cx: number, cz: number, w: number, d: number) => {
      b.box({ x: cx, y: -3, z: cz, w, h: 3, d, mat: 'stone', r: 0.08 });
      let y = -3;
      const tiers: [number, number][] = [
        [0.86, 3.5],
        [0.68, 4.5],
        [0.5, 5.5],
        [0.3, 7],
        [0.14, 6],
      ];
      for (const [f, h] of tiers) {
        b.box({ x: cx, y: y - h, z: cz, w: w * f, h, d: d * f, mat: 'under', collide: false, r: 0.06 });
        islandBoxes.push({ min: new THREE.Vector3(cx - (w * f) / 2, y - h, cz - (d * f) / 2), max: new THREE.Vector3(cx + (w * f) / 2, y, cz + (d * f) / 2) });
        y -= h;
      }
      islandBoxes.push({ min: new THREE.Vector3(cx - w / 2, -3, cz - d / 2), max: new THREE.Vector3(cx + w / 2, 4, cz + d / 2) });
    };
    const lantern = (x: number, y: number, z: number, h = 2.2) => {
      b.box({ x, y, z, w: 0.22, h, d: 0.22, mat: 'stone', r: 0.03 });
      b.box({ x, y: y + h, z, w: 0.26, h: 0.34, d: 0.26, mat: 'lantern', collide: false, r: 0.04 });
    };

    // --- Île A (arrivée)
    island(0, -1, 26, 22);
    // terrasse du belvédère (nord-est)
    b.box({ x: 9, y: 0, z: -7, w: 6, h: 4, d: 8, mat: 'stone', r: 0.06 });
    b.stairs({ x: 9, y: 0, z: 2.6, w: 2.2, steps: 13, rise: 4 / 13, run: 0.43, rotY: Math.PI, mat: 'stone' });
    const disc = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 40);
    b.custom(disc, new THREE.Matrix4().makeTranslation(9, 4.005, -8), 'bronze', 1);
    // colonnade et murets
    for (const x of [-10, -6]) for (const z of [-9, -3, 3]) b.column({ x, y: 0, z, h: 6.5, r: 0.42, classic: true });
    b.box({ x: -8, y: 6.5, z: -3, w: 6.2, h: 0.8, d: 14, mat: 'stone', collide: false, r: 0.06 });
    b.box({ x: 3.5, y: 0, z: -11.2, w: 3, h: 1.1, d: 0.8, mat: 'stone', r: 0.04 });
    b.box({ x: -3.5, y: 0, z: -11.2, w: 3, h: 1.1, d: 0.8, mat: 'stone', r: 0.04 });
    lantern(2.4, 0, -11.2);
    lantern(-2.4, 0, -11.2);
    lantern(-12, 0, 8);
    lantern(12, 0, 8);
    // seuil de l'anneau d'arrivée
    b.box({ x: 0, y: 0, z: 9, w: 9, h: 0.32, d: 2.6, mat: 'stone', r: 0.03 });

    // --- Île B (le monolithe)
    island(0, -58.5, 30, 27);
    for (const x of [-12, 12]) for (const z of [-50, -58, -66]) b.column({ x, y: 0, z, h: 7.5, r: 0.45, classic: true });
    lantern(2.4, 0, -46);
    lantern(-2.4, 0, -46);
    // Monolithe : 20 × 90 × 16 m
    b.box({ x: 0, y: -40, z: -80, w: 20, h: 90, d: 16, mat: 'stone', r: 0.12 });
    islandBoxes.push({ min: new THREE.Vector3(-11, -40, -89), max: new THREE.Vector3(11, 56, -71) });
    // ligne vermillon au sol jusqu'à la paroi, puis le seuil de gravité
    b.box({ x: 0, y: 0, z: -56, w: 0.24, h: 0.03, d: 28, mat: 'verm', collide: false, r: 0.01 });
    b.box({ x: 0, y: 0, z: -71.2, w: 7, h: 0.035, d: 1.6, mat: 'verm', collide: false, r: 0.01 });
    // sommet : disque de bronze du dernier point de vue, quelques volumes
    b.custom(disc, new THREE.Matrix4().makeTranslation(GATE_VIEW.x, SUMMIT_Y + 0.005, GATE_VIEW.z), 'bronze', 1);
    disc.dispose();
    b.box({ x: -7, y: SUMMIT_Y, z: -75, w: 2.4, h: 1.2, d: 2.4, mat: 'stone', r: 0.05 });
    b.box({ x: -6.5, y: SUMMIT_Y, z: -84, w: 3, h: 0.8, d: 1.6, mat: 'stone', r: 0.05 });
    lantern(-8.8, SUMMIT_Y, -74, 1.6);
    lantern(8.8, SUMMIT_Y, -74, 1.6);

    // --- Lointains : architecture impossible
    b.box({ x: -260, y: -60, z: -420, w: 60, h: 260, d: 60, mat: 'under', collide: false, r: 0.5 });
    b.box({ x: 320, y: -60, z: -300, w: 40, h: 180, d: 40, mat: 'under', collide: false, r: 0.5 });
    for (const [x, z, w] of [
      [-140, -160, 18],
      [180, -120, 24],
      [90, -340, 30],
      [-60, 160, 20],
      [220, 90, 16],
    ] as [number, number, number][]) {
      island(x, z, w, w * 0.8);
    }
    for (const m of b.build(mats)) this.root.add(m);

    // Pyramide inversée suspendue et anneaux colossaux (sans collision)
    const far = new Builder(null, 77);
    for (let i = 0; i < 7; i++) {
      const s = 70 - i * 10;
      far.box({ x: 240, y: 140 - i * 9, z: -520, w: s, h: 9, d: s, mat: 'under', r: 0.3 });
    }
    const ringGeo = new THREE.TorusGeometry(70, 4.5, 16, 96);
    far.custom(ringGeo, new THREE.Matrix4().compose(new THREE.Vector3(-320, -30, -260), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.9, 0)), new THREE.Vector3(1, 1, 1)), 'stone', 0.9);
    far.custom(ringGeo, new THREE.Matrix4().compose(new THREE.Vector3(360, -20, 40), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.6, 0)), new THREE.Vector3(0.7, 0.7, 0.7)), 'stone', 0.9);
    ringGeo.dispose();
    for (const m of far.build(mats, { castShadow: false })) this.root.add(m);

    // --- Pierres flottantes d'ambiance (rotation lente)
    const rng = new Rng(9);
    const fGeo = withWhite(new RoundedBoxGeometry(1, 1, 1, 1, 0.08));
    const nF = Math.round(160 * q.particleDensity) + 40;
    this.floaters = new THREE.InstancedMesh(fGeo, under, nF);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < nF; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(30, 220);
      const s = rng.range(0.3, 3.5);
      m4.compose(
        new THREE.Vector3(Math.cos(a) * r, rng.range(-35, 40), Math.sin(a) * r - 40),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.next() * 6, rng.next() * 6, rng.next() * 6)),
        new THREE.Vector3(s, s * rng.range(0.5, 1.5), s * rng.range(0.5, 1.2)),
      );
      this.floaters.setMatrixAt(i, m4);
    }
    this.floaters.castShadow = false;
    this.root.add(this.floaters);

    // --- Référentiel de la paroi (gravité tournée de 90°)
    const wallObj = new THREE.Group();
    wallObj.position.set(0, 0, -72);
    wallObj.rotation.x = Math.PI / 2;
    this.root.add(wallObj);
    this.wallFrame = new GravityFrame('wall', wallObj);
    this.wallFrame.killY = -30;
    this.frames.push(this.wallFrame);
    const wb = new Builder(this.wallFrame.colliders, 52);
    // la face du monolithe sert de sol (collision seulement : la géométrie est celle du monolithe)
    this.wallFrame.colliders.addBox(0, -8, -24, 20, 16, 52);
    // garde-fou invisible en bas (on redescend par le seuil)
    for (const [x, z, w, h, d] of [
      [-5.5, -14, 2.4, 2.2, 2.4],
      [4.5, -24, 3.6, 1.6, 1.8],
      [-2.5, -33, 1.8, 3.0, 1.8],
      [6, -40, 2.2, 2.2, 2.2],
      [-6.5, -44, 2.6, 1.4, 1.4],
    ] as [number, number, number, number, number][]) {
      wb.box({ x, y: 0, z, w, h, d, mat: 'stone', r: 0.05 });
    }
    // ligne vermillon gravissant la paroi
    wb.box({ x: 0, y: 0, z: -24.5, w: 0.24, h: 0.03, d: 49, mat: 'verm', collide: false, r: 0.01 });
    wb.box({ x: 0, y: 0, z: -48.8, w: 7, h: 0.035, d: 1.6, mat: 'verm', collide: false, r: 0.01 });
    lanternWall(wb);
    for (const m of wb.build(mats)) wallObj.add(m);

    // --- Figure 1 : le pont (vu depuis la terrasse)
    const bridgeEye = new THREE.Vector3(9, 4 + 1.62, -8);
    const specs: PieceSpec[] = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const z = -12.75 - i * 1.5;
      const id = new THREE.Quaternion();
      specs.push({ type: 0, pos: new THREE.Vector3(0, -0.35, z), quat: id, scale: new THREE.Vector3(3.2, 0.7, 1.48) });
      specs.push({ type: 1, pos: new THREE.Vector3(-1.44, 0.275, z), quat: id, scale: new THREE.Vector3(0.32, 0.55, 1.48) });
      specs.push({ type: 1, pos: new THREE.Vector3(1.44, 0.275, z), quat: id, scale: new THREE.Vector3(0.32, 0.55, 1.48) });
      specs.push({ type: 2, pos: new THREE.Vector3(0, 0.02, z), quat: id, scale: new THREE.Vector3(0.22, 0.04, 1.42) });
    }
    const unitBox = withWhite(new RoundedBoxGeometry(1, 1, 1, 1, 0.04));
    const reject = (p: THREE.Vector3, size: number) => {
      if (p.y < -30) return true;
      for (const bb of islandBoxes) {
        if (p.x > bb.min.x - size && p.x < bb.max.x + size && p.y > bb.min.y - size && p.y < bb.max.y + size && p.z > bb.min.z - size && p.z < bb.max.z + size) return true;
      }
      return false;
    };
    this.bridge = new FragmentFigure(
      specs,
      [
        { geometry: unitBox, material: stone },
        { geometry: unitBox, material: stone },
        { geometry: unitBox, material: verm, castShadow: false },
      ],
      { eye: bridgeEye, kMin: 0.5, kMax: 1.9, seed: 12, wobble: 0.45, reject },
    );
    this.root.add(this.bridge.group);
    this.bridgeColliders.push(
      cs.addBox(0, -0.35, -28.5, 3.2, 0.7, 33, { enabled: false }),
      cs.addBox(-1.44, 0.275, -28.5, 0.32, 0.55, 33, { enabled: false }),
      cs.addBox(1.44, 0.275, -28.5, 0.32, 0.55, 33, { enabled: false }),
    );
    this.bridgeAnam = new Anamorphosis({ name: 'pont', frame: this.mainFrame, foot: new THREE.Vector3(9, 4, -8), focus: new THREE.Vector3(0, 0, -28), sigma: 3.0, hearRadius: 36 });
    this.anamorphoses.push(this.bridgeAnam);

    // --- Figure 2 : la Porte de la Nuit (vue depuis le sommet)
    const gateEye = GATE_VIEW.clone().setY(SUMMIT_Y + 1.62);
    const gspecs: PieceSpec[] = [];
    const gz = NIGHT_GATE.z;
    const gy = SUMMIT_Y;
    const blk = new THREE.Vector3(2.4, 2.4, 2.4);
    for (const side of [-1, 1]) {
      gspecs.push({ type: 0, pos: new THREE.Vector3(side * 8, gy - 0.5, gz), quat: new THREE.Quaternion(), scale: new THREE.Vector3(4, 1, 4) });
      for (let i = 0; i < 5; i++) gspecs.push({ type: 0, pos: new THREE.Vector3(side * 8, gy + 1.2 + i * 2.4, gz), quat: new THREE.Quaternion(), scale: blk.clone() });
    }
    for (let j = 0; j <= 8; j++) {
      const th = (j * Math.PI) / 8;
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), th);
      gspecs.push({ type: j === 4 ? 1 : 0, pos: new THREE.Vector3(Math.cos(th) * 8, gy + 12 + Math.sin(th) * 8, gz), quat, scale: new THREE.Vector3(2.4, 3.0, 2.4) });
    }
    this.gate = new FragmentFigure(
      gspecs,
      [
        { geometry: unitBox, material: stone },
        { geometry: unitBox, material: verm },
      ],
      { eye: gateEye, kMin: 0.45, kMax: 2.3, seed: 31, wobble: 0.8, reject },
    );
    this.root.add(this.gate.group);
    this.gateAnam = new Anamorphosis({ name: 'porte', frame: this.mainFrame, foot: GATE_VIEW.clone(), focus: new THREE.Vector3(0, gy + 10, gz), sigma: 3.0, hearRadius: 45 });
    this.anamorphoses.push(this.gateAnam);

    // --- Pont de lumière (après la porte) : dalles qui montent des nuages
    const nLB = 18;
    this.lightBridge = new THREE.InstancedMesh(unitBox, stone, nLB);
    this.lightBridge.visible = false;
    this.lightBridge.castShadow = true;
    this.lightBridge.receiveShadow = true;
    this.root.add(this.lightBridge);
    this.lightBridgeColliders.push(cs.addBox(0, SUMMIT_Y - 0.35, -106.5, 3.4, 0.7, 37, { enabled: false }));

    // --- Anneau d'arrivée et portail retour (on aperçoit le Seuil)
    this.ring = new Emblem(atm, PORTAL_R, 0.47, 1, 0.01, PORTAL_R + 0.25, 0.1);
    this.ring.inner.visible = false;
    this.ring.reveal = 0;
    this.ring.glow = 2.4;
    this.ring.group.position.copy(ARRIVAL);
    this.root.add(this.ring.group);
    this.backPortal = new Portal(PORTAL_R, ctx.graphics.hdrType);
    this.backPortal.setEnds(ARRIVAL, Math.PI, GATE_PORTAL_POS, Math.PI);
    this.root.add(this.backPortal.mesh);
    this.portal = new Portal(PORTAL_R, ctx.graphics.hdrType);
    this.root.add(this.portal.mesh);

    // --- Lumière
    this.setupSun(hdr(0xffa27a, 1), 2.2, new THREE.Vector3(0, 10, -45), 75, 320, q.shadowMapSize, q.shadowRadius);
    this.sun.position.copy(new THREE.Vector3(0, 10, -45)).add(new THREE.Vector3(-0.92, 0.16, -0.38).normalize().multiplyScalar(160));
    this.buildEnvironment(renderer);
    this.scene.environmentIntensity = 1.2;

    this.motes = new Motes(atm, Math.round(500 * q.particleDensity), 30, 0.12, 0.05);
    this.scene.add(this.motes.points);
    this.dust = new DustBursts(atm, 600, new THREE.Color(0.7, 0.68, 0.72));
    this.scene.add(this.dust.points);

    this.spawn = { frame: this.mainFrame, x: 0, y: 0, z: 6.5, yaw: 0, pitch: 0 };

    const g = this.grade;
    g.exposure = 1.08;
    g.bloomStrength = 0.11;
    g.bloomThreshold = 1.1;
    g.vignette = 0.36;
    g.lift.setRGB(0.012, 0.014, 0.03);
    g.gain.setRGB(1.0, 0.99, 1.02);
    g.saturation = 1.05;
    g.contrast = 1.04;

    function lanternWall(wb2: Builder): void {
      for (const z of [-12, -30, -46]) {
        for (const x of [-9, 9]) {
          wb2.box({ x, y: 0, z, w: 0.22, h: 1.6, d: 0.22, mat: 'stone', r: 0.03 });
          wb2.box({ x, y: 1.6, z, w: 0.36, h: 0.42, d: 0.36, mat: 'lantern', collide: false, r: 0.04 });
        }
      }
    }
  }

  /** Portail vers le Point de fuite (appelé quand la scène existe). */
  private linkPortal(): void {
    const dest = this.ctx.stage('vanishing') as (Stage & { arrival?: { pos: THREE.Vector3; yaw: number } }) | undefined;
    if (!dest?.arrival) return;
    this.portal.setEnds(NIGHT_GATE, 0, dest.arrival.pos, dest.arrival.yaw);
  }

  enter(host: StageHost): void {
    super.enter(host);
    this.startTunings();
    if (this.phase === 'bridge') {
      this.backPortal.enabled = true;
      this.backPortal.open = 1;
    }
  }

  begin(): void {
    this.startTunings();
    // Entrée directe (sélection de chapitre) : pas de vue en arrière vers le Seuil.
    if (!this.viaPortal) {
      this.backPortal.enabled = false;
      this.backPortal.open = 0;
    }
  }

  exit(): void {
    super.exit();
    this.gateHum?.stop(3);
    this.gateHum = null;
    this.tuningBridge?.dispose();
    this.tuningGate?.dispose();
    this.tuningBridge = null;
    this.tuningGate = null;
  }

  private startTunings(): void {
    const a = this.ctx.audio;
    if (!a.ready) return;
    // Si mineur (pont) et sol lydien (porte)
    if (!this.tuningBridge && this.bridgeAnam.state === 'idle') this.tuningBridge = a.createTuning(new THREE.Vector3(0, 0, -28), [47, 54, 62, 69, 73].map(midi));
    if (!this.tuningGate && this.gateAnam.state === 'idle') this.tuningGate = a.createTuning(new THREE.Vector3(0, SUMMIT_Y + 10, -122), [43, 50, 54, 59, 61].map(midi));
  }

  musicIntensity(): number {
    switch (this.phase) {
      case 'bridge':
        return 0.15 + this.bridgeAnam.alignment * 0.2;
      case 'bridgeEvent':
        return 0.5;
      case 'island':
        return this.host?.player.frame === this.wallFrame ? 0.65 : 0.4;
      case 'summit':
        return 0.6 + this.gateAnam.alignment * 0.2;
      default:
        return 0.85;
    }
  }

  tickAmbient(dt: number, camera: THREE.Camera): void {
    super.tickAmbient(dt, camera);
    this.clouds.update(this.time, camera);
    this.bridge.calm = this.bridgeAnam.posAlign;
    this.gate.calm = this.gateAnam.posAlign;
    this.bridge.update(dt);
    this.gate.update(dt);
    this.ring.update(this.time);
    this.floaters.rotation.y += dt * 0.004;
    const lanternPulse = 3.0 + Math.sin(this.time * 1.3) * 0.2;
    this.lanternMat.emissiveIntensity = lanternPulse * (1 + this.night * 0.6);
  }

  update(dt: number, camera: THREE.Camera): void {
    super.update(dt, camera);
    const host = this.host;
    const g = this.ctx.graphics;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 70;
    const pixel = g.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.motes.update(this.time, camera, pixel);
    this.dust.update(dt, pixel);
    this.phaseTime += dt;
    this.shiftCooldown -= dt;
    if (!host) return;
    const p = host.player;

    this.startTunings();
    if (this.bridgeAnam.state === 'idle') this.tuningBridge?.update(this.bridgeAnam.alignment, this.bridgeAnam.proximity);
    if (this.gateAnam.state === 'idle') this.tuningGate?.update(this.gateAnam.alignment, this.gateAnam.proximity);

    // Portail retour : se referme quand on s'éloigne.
    if (this.backPortal.enabled) {
      this.backPortalTime += dt;
      const d = camera.position.distanceTo(ARRIVAL);
      if (this.backPortalTime > 6 && (d > 26 || this.backPortalTime > 45) && this.backPortal.open > 0) {
        this.backPortal.open = Math.max(0, this.backPortal.open - dt / 3);
        if (this.backPortal.open <= 0) this.backPortal.enabled = false;
      }
    }

    this.updateGravity(p);
    this.updateHints(host);

    if (this.phase === 'night' && !this.crossed && this.portal.crossed(camera.position)) {
      this.crossed = true;
      this.crossToVanishing();
    }
  }

  // ================================================================ Gravité
  private updateGravity(p: StageHost['player']): void {
    if (this.shiftCooldown > 0 || p.shifting || p.gliding || p.frozen) return;
    const audio = this.ctx.audio;
    const fx = () => {
      this.shiftCooldown = 1.0;
      if (audio.ready) {
        audio.inst.boom(audio.now(), 0.22, 38);
        audio.inst.riser(audio.now(), 1.4, 0.05, 2000, 200);
        [59, 66, 71].forEach((n2, i) => audio.inst.bell(midi(n2), audio.now() + 0.2 + i * 0.12, { gain: 0.03, ratio: 2, index: 0.4, decay: 3 }));
      }
      this.host?.shake(0.2, 1.2);
    };
    const pos = p.pos;
    if (p.frame === this.mainFrame) {
      // île B → paroi
      if (pos.z < -70.4 && Math.abs(pos.x) < 9.5 && pos.y < 0.5 && pos.y > -0.5) {
        fx();
        p.shiftFrame(this.wallFrame, clamp(pos.x, -9, 9), 0, -1.0, 0, 0.05, 1.7);
        this.everOnWall = true;
        if (!this.wallHinted) {
          this.wallHinted = true;
          window.setTimeout(() => this.host?.hint('Ici, le bas est ailleurs.', 5), 1900);
        }
      }
      // sommet → paroi (redescendre)
      if (pos.y > SUMMIT_Y - 1 && pos.z > -72.5 && Math.abs(pos.x) < 9.5) {
        fx();
        p.shiftFrame(this.wallFrame, clamp(pos.x, -9, 9), 0, -48.0, Math.PI, 0, 1.7);
      }
    } else if (p.frame === this.wallFrame) {
      // paroi → sommet
      if (pos.z < -48.7) {
        fx();
        p.shiftFrame(this.mainFrame, clamp(pos.x, -9, 9), SUMMIT_Y, -73.6, 0, -0.05, 1.7);
        if (this.phase === 'island') {
          this.phase = 'summit';
          this.phaseTime = 0;
        }
      }
      // paroi → île B
      if (pos.z > 0.25) {
        fx();
        p.shiftFrame(this.mainFrame, clamp(pos.x, -9, 9), 0, -70.0, Math.PI, 0, 1.7);
      }
    }
  }

  private updateHints(host: StageHost): void {
    const t = this.phaseTime;
    const p = host.player;
    if (this.phase === 'bridge') {
      if (this.hintStep === 0 && t > 4) {
        this.hintStep = 1;
      } else if (this.hintStep === 1 && t > 28 && this.bridgeAnam.distance > 5) {
        this.hintStep = 2;
        host.hint('Ces pierres suspendues attendent un regard. Une terrasse domine le vide.', 7);
      } else if (this.hintStep === 2 && t > 65 && this.bridgeAnam.distance > 3) {
        this.hintStep = 3;
        host.hint('Montez l’escalier de la terrasse, au nord-est de l’île.', 7);
      } else if (this.hintStep === 3 && t > 100 && this.bridgeAnam.distance > 1.5) {
        this.hintStep = 4;
        host.hint('Depuis le disque de bronze, regardez vers l’île du monolithe et maintenez {clic}.', 8);
      }
    } else if (this.phase === 'island') {
      if (this.hintStep < 20 && t > 4) {
        this.hintStep = 20;
        host.hint('Suivez la ligne vermillon.', 5);
      } else if (this.hintStep === 20 && t > 45 && p.frame === this.mainFrame && !this.everOnWall) {
        this.hintStep = 21;
        host.hint('La ligne continue sur la paroi. Avancez jusqu’au seuil, au pied du monolithe.', 7);
      }
    } else if (this.phase === 'summit') {
      if (this.hintStep < 30 && t > 3) {
        this.hintStep = 30;
        host.hint('Au sommet, une dernière figure attend son point de vue.', 6);
      } else if (this.hintStep === 30 && t > 45 && this.gateAnam.distance > 2) {
        this.hintStep = 31;
        host.hint('Un disque de bronze, à l’angle nord-est du sommet, marque le point de vue.', 7);
      }
    } else if (this.phase === 'night') {
      if (this.hintStep < 40 && t > 30) {
        this.hintStep = 40;
        host.hint('Le chemin de pierre mène à la Porte. Traversez-la.', 6);
      }
    }
  }

  // ================================================================ Verrouillages
  onLock(a: Anamorphosis): void {
    if (a === this.bridgeAnam) this.lockBridge();
    else if (a === this.gateAnam) this.lockGate();
  }

  private lockBridge(): void {
    const host = this.host!;
    const audio = this.ctx.audio;
    const inst = audio.ready ? audio.inst : null;
    this.phase = 'bridgeEvent';
    host.clearHint();
    this.tuningBridge?.resolve();
    this.shadowLive = true;
    const eye = new THREE.Vector3(9, 5.62, -8);
    const focus = new THREE.Vector3(0, 0, -28);
    const eyeQ = lookQuat(new THREE.Quaternion(), eye, focus);
    const side = new THREE.Vector3(-22, 7, -24);
    const sideLook = new THREE.Vector3(0, -1, -29);
    let ph = 0;
    let t0 = 0;
    host.director.play((t, out) => {
      if (ph === 0) {
        out.pos.copy(eye);
        out.quat.copy(eyeQ);
        out.fov = 72;
        return;
      }
      const k = ease.inOutCubic(clamp((t - t0) / 3.2));
      out.pos.lerpVectors(eye, side, k);
      out.pos.y += Math.sin(k * Math.PI) * 4;
      const look = new THREE.Vector3().lerpVectors(focus, sideLook, k);
      lookQuat(out.quat, out.pos, look);
      out.fov = lerp(72, 60, k);
    }, 0.4);

    // Notes du pont : si mineur pentatonique, ascendant.
    const notes = [59, 62, 64, 66, 69, 71, 74, 76, 78, 81, 83];
    let slabCount = 0;
    this.bridge.onPieceLanded = (type, wp) => {
      if (type === 0) {
        const nn = notes[slabCount % notes.length] + (slabCount >= notes.length ? 12 : 0);
        if (audio.ready) audio.inst.stone(wp, midi(nn - 12), 0.45);
        if (slabCount % 3 === 0) this.dust.burst(wp, new THREE.Vector3(1.4, 0.2, 0.6), 6, 0.8, 1.4, 2.5);
        slabCount++;
      }
    };
    const seq = new Sequence();
    seq.at(0, () => {
      inst?.boom(audio.now(), 0.3, 49);
      inst?.pad([47, 54, 59, 62, 66, 69].map(midi), audio.now(), 5, { gain: 0.1, attack: 0.1, release: 5, cutoff: 2200, reed: true });
      host.flash(0.25, 0xffc0a0);
      host.shake(0.2, 0.7);
    });
    seq.at(1.2, () => {
      ph = 1;
      t0 = seq.t;
      inst?.whoosh(1.8, 0.05);
    });
    seq.at(2.2, () => {
      this.bridge.assemble((x, y) => y.pos.z - x.pos.z + (x.type - y.type) * 0.01, 0.085, 1.9);
    });
    seq.at(2.2 + 22 * 4 * 0.085 + 1.9, () => {
      for (const c of this.bridgeColliders) c.enabled = true;
      inst?.timpani(midi(35), audio.now(), 0.3);
      inst?.bell(midi(83), audio.now(), { gain: 0.05, decay: 5 });
      host.director.release(1.8);
    });
    seq.at(2.2 + 22 * 4 * 0.085 + 3.9, () => {
      this.shadowLive = false;
      this.shadowDirty = true;
      this.phase = 'island';
      this.phaseTime = 0;
      host.player.frozen = false;
      host.reach(2);
    });
    this.play(seq);
  }

  private lockGate(): void {
    const host = this.host!;
    const audio = this.ctx.audio;
    const inst = audio.ready ? audio.inst : null;
    this.phase = 'gateEvent';
    host.clearHint();
    this.tuningGate?.resolve();
    this.linkPortal();
    this.shadowLive = true;
    const eye = GATE_VIEW.clone().setY(SUMMIT_Y + 1.62);
    const focus = new THREE.Vector3(0, SUMMIT_Y + 10, -122);
    const eyeQ = lookQuat(new THREE.Quaternion(), eye, focus);
    const wide = new THREE.Vector3(34, SUMMIT_Y + 16, -70);
    const wideLook = new THREE.Vector3(0, SUMMIT_Y + 8, -112);
    const back = new THREE.Vector3(0, SUMMIT_Y + 3.5, -76);
    let ph = 0;
    let t0 = 0;
    host.director.play((t, out) => {
      if (ph === 0) {
        out.pos.copy(eye);
        out.quat.copy(eyeQ);
        out.fov = 72;
      } else if (ph === 1) {
        const k = ease.inOutCubic(clamp((t - t0) / 4.5));
        out.pos.lerpVectors(eye, wide, k);
        lookQuat(out.quat, out.pos, new THREE.Vector3().lerpVectors(focus, wideLook, k));
        out.fov = lerp(72, 62, k);
      } else {
        const k = ease.inOutCubic(clamp((t - t0) / 5));
        out.pos.lerpVectors(wide, back, k);
        lookQuat(out.quat, out.pos, new THREE.Vector3().lerpVectors(wideLook, NIGHT_GATE, k));
        out.fov = lerp(62, 66, k);
      }
    }, 0.4);
    const notes = [43, 50, 55, 59, 62, 66, 67, 71, 74];
    let count = 0;
    this.gate.onPieceLanded = (_type, wp) => {
      if (audio.ready) {
        audio.inst.boom(audio.now(), 0.12, 50);
        audio.inst.stone(wp, midi(notes[count % notes.length]), 0.5);
      }
      host.shake(0.12, 0.4);
      this.dust.burst(wp, new THREE.Vector3(1.2, 0.6, 1.2), 10, 1.2, 2.4, 3);
      count++;
    };
    const day = this.dayParams;
    const nightP = this.nightParams;
    const cd = this.cloudDay;
    const cu = this.clouds.uniforms;
    const sunI0 = this.sun.intensity;
    const sunC0 = this.sun.color.clone();
    const g = this.grade;
    const ex0 = g.exposure;
    const seq = new Sequence();
    seq.at(0, () => {
      inst?.boom(audio.now(), 0.4, 43);
      inst?.pad([43, 50, 55, 59, 61, 66].map(midi), audio.now(), 7, { gain: 0.11, attack: 0.1, release: 7, cutoff: 2000 });
      host.flash(0.3, 0xffc8a8);
      host.shake(0.25, 0.8);
    });
    seq.at(1.0, () => {
      ph = 1;
      t0 = seq.t;
      this.gate.assemble((x, y) => x.pos.y - y.pos.y, 0.28, 2.4);
    });
    const gateDone = 1.0 + 20 * 0.28 + 2.4;
    // La nuit tombe.
    seq.span(gateDone - 2, gateDone + 7, (k) => {
      const e = ease.inOutSine(k);
      this.night = e;
      this.atmosphere.blend(day, nightP, e);
      (cu.uLit.value as THREE.Color).copy(cd.lit).lerp(hdr(0x5a6a9a, 0.35), e);
      (cu.uShade.value as THREE.Color).copy(cd.shade).lerp(hdr(0x101a36, 0.18), e);
      (cu.uDeep.value as THREE.Color).copy(cd.deep).lerp(hdr(0x03050c, 0.15), e);
      this.sky.uniforms.uStars.value = lerp(0.25, 1.2, e);
      this.sky.uniforms.uClouds.value = lerp(0.22, 0.08, e);
      this.sun.intensity = lerp(sunI0, 0.55, e);
      this.sun.color.copy(sunC0).lerp(hdr(0x8aa0d8, 1), e);
      this.scene.environmentIntensity = lerp(1.2, 0.3, e);
      g.exposure = lerp(ex0, 1.25, e);
    });
    seq.at(gateDone - 2, () => {
      if (audio.ready) {
        audio.inst.riser(audio.now(), 8, 0.05, 6000, 300);
        audio.music.setIntensity(0.9);
      }
    });
    seq.at(gateDone, () => {
      ph = 2;
      t0 = seq.t;
      inst?.timpani(midi(31), audio.now(), 0.35);
    });
    // Pont de pierre qui monte des nuages.
    const lb = this.lightBridge;
    const m4 = new THREE.Matrix4();
    const qId = new THREE.Quaternion();
    const sc = new THREE.Vector3(3.4, 0.7, 2.0);
    seq.at(gateDone + 1, () => (lb.visible = true));
    seq.span(gateDone + 1, gateDone + 7, (k) => {
      for (let i = 0; i < 18; i++) {
        const local = clamp((k * 18 - i * 0.6) / 4);
        const e = ease.outCubic(local);
        const y = lerp(SUMMIT_Y - 60, SUMMIT_Y - 0.35, e);
        m4.compose(new THREE.Vector3(0, y, -89 - i * 2.0), qId, sc);
        lb.setMatrixAt(i, m4);
        if (local > 0.98 && local < 1) {
          /* rien */
        }
      }
      lb.instanceMatrix.needsUpdate = true;
    });
    seq.at(gateDone + 4.2, () => {
      this.portal.enabled = true;
      if (audio.ready) {
        audio.inst.riser(audio.now(), 2.6, 0.07, 300, 9000);
        this.gateHum = audio.inst.hum(NIGHT_GATE.clone(), [55, 82.4, 110], 0.08);
      }
    });
    seq.span(gateDone + 4.2, gateDone + 7, (k) => (this.portal.open = ease.outCubic(k)));
    seq.at(gateDone + 7.2, () => {
      for (const c of this.lightBridgeColliders) c.enabled = true;
      host.director.release(2.2);
    });
    seq.at(gateDone + 9.4, () => {
      this.shadowLive = false;
      this.shadowDirty = true;
      this.phase = 'night';
      this.phaseTime = 0;
      host.player.frozen = false;
      host.hint('La nuit est tombée. Le chemin est ouvert.', 6);
    });
    this.play(seq);
  }

  private crossToVanishing(): void {
    const host = this.host;
    if (!host) return;
    const portal = this.portal;
    this.phase = 'gone';
    host.advanceSeamless('vanishing', (player) => {
      const dest = this.ctx.stage('vanishing')!;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      player.computeWorldPose(pos, quat);
      portal.transferPose(pos, quat);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      player.teleport(dest.mainFrame, pos.x, pos.y - player.eyeHeight, pos.z, Math.atan2(-fwd.x, -fwd.z), Math.asin(clamp(fwd.y, -1, 1)));
    });
  }

  preRender(graphics: Graphics, camera: THREE.PerspectiveCamera): void {
    const r = graphics.renderer;
    const sm = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false;
    const scale = this.ctx.quality.portalScale;
    if (this.backPortal.enabled) {
      const src = this.ctx.stage('threshold');
      if (src) {
        r.shadowMap.needsUpdate = src.shadowDirty;
        src.shadowDirty = false;
        this.backPortal.setResolution(graphics.width, graphics.height, scale);
        this.backPortal.render(r, camera, src.scene, this.time, graphics.width, graphics.height);
        this.backPortal.material.uniforms.uExposure.value = src.grade.exposure / this.grade.exposure;
      }
    } else {
      this.backPortal.mesh.visible = false;
    }
    if (this.portal.enabled) {
      const dest = this.ctx.stage('vanishing');
      if (dest) {
        r.shadowMap.needsUpdate = dest.shadowDirty;
        dest.shadowDirty = false;
        dest.tickAmbient(1 / 60, this.portal.vcam);
        this.portal.setResolution(graphics.width, graphics.height, scale);
        this.portal.render(r, camera, dest.scene, this.time, graphics.width, graphics.height, (vc, tw, th) => dest.preRender(graphics, vc, tw, th));
        this.portal.material.uniforms.uExposure.value = dest.grade.exposure / this.grade.exposure;
      }
    }
    r.shadowMap.needsUpdate = sm;
  }

  dispose(): void {
    super.dispose();
    this.bridge.dispose();
    this.gate.dispose();
    this.portal.dispose();
    this.backPortal.dispose();
    this.clouds.dispose();
    this.motes.dispose();
    this.dust.dispose();
    this.ring.dispose();
  }
}
