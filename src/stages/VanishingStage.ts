import * as THREE from 'three';
import { Stage, type StageContext, type StageHost } from './Stage';
import { Atmosphere, hdr, ATMOSPHERE_PARS, type AtmosphereParams } from '../render/Atmosphere';
import { Sky } from '../world/Sky';
import { Builder } from '../world/Builder';
import { extendSurface } from '../render/Surface';
import { Anamorphosis } from '../world/Anamorphosis';
import { Water } from '../world/Water';
import { Emblem } from '../world/Emblem';
import { Motes } from '../world/Particles';
import type { TuningVoice } from '../audio/AudioEngine';
import { midi } from '../audio/AudioEngine';
import { Sequence } from '../util/Sequence';
import { Rng, clamp, damp, ease, lerp, smoothstep } from '../util/math';
import { lookQuat } from '../app/Director';
import type { Graphics } from '../render/Graphics';
import { GATE_PORTAL_R } from './ThresholdStage';

const WATER_Y = -1.2;
const RING_CENTER = new THREE.Vector3(0, WATER_Y, -520);
const RING_R = 112;
const START_Z = 12;
const END_Z = -112;
const OBELISK_Z = [-2, -14, -26, -38, -50, -62, -74, -86, -98];

/** Fentes lumineuses des obélisques (une instance par obélisque). */
const GLOW_VERT = /* glsl */ `
attribute float aGlow;
varying float vGlow;
varying vec3 vWPos;
void main() {
  vGlow = aGlow;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GLOW_FRAG = /* glsl */ `
${ATMOSPHERE_PARS}
uniform vec3 uColor;
uniform vec3 uIdle;
varying float vGlow;
varying vec3 vWPos;
void main() {
  vec3 col = mix(uIdle, uColor, vGlow);
  gl_FragColor = vec4(applyAtmosphere(col, vWPos, cameraPosition), 1.0);
}`;

/** Chapitre III — Le Point de fuite : une chaussée sur l'eau, la nuit, vers l'horizon. */
export class VanishingStage extends Stage {
  readonly id = 'vanishing';
  readonly chapter = 3;
  readonly arrival = { pos: new THREE.Vector3(0, GATE_PORTAL_R - 1.2, START_Z + 2), yaw: 0 };
  private water!: Water;
  private ringA!: THREE.Group;
  private ringB!: THREE.Group;
  private ringMat!: THREE.MeshStandardMaterial;
  private slits!: THREE.InstancedMesh;
  private slitGlow!: Float32Array;
  private slitTarget: number[] = [];
  private finalAnam!: Anamorphosis;
  private tuning: TuningVoice | null = null;
  private motes!: Motes;
  private arrivalRing!: Emblem;
  private nightP!: AtmosphereParams;
  private dawnP!: AtmosphereParams;
  private progress = 0;
  private converge = 0;
  phase: 'walk' | 'finale' | 'end' = 'walk';
  private lit: boolean[] = [];
  private hintStep = 0;
  private sunScale = 1;

  build(ctx: StageContext): void {
    this.ctx = ctx;
    const q = ctx.quality;
    this.musicScene = 'vanishing';
    this.reverb = [6, 2.2, 1.0];
    this.card = ['Chapitre III', 'Le Point de fuite', 'Là où toutes les lignes se rejoignent.'];
    this.next = null;
    this.far = 4000;

    this.nightP = {
      sunDir: new THREE.Vector3(0, 0.004, -1).normalize(),
      sunColor: hdr(0xffd6a0, 0.55),
      zenith: hdr(0x02040b, 0.3),
      mid: hdr(0x08122a, 0.35),
      horizon: hdr(0x1c2850, 0.42),
      ground: hdr(0x03050c, 0.2),
      shape: new THREE.Vector4(0.45, 2.0, 40, 0.35),
      sunGlow: new THREE.Vector4(0.08, 6, 0.6, 400),
      fog: new THREE.Vector4(0.0016, 0.08, WATER_Y, 0.9),
      fogTint: new THREE.Color(0.9, 0.95, 1.1),
      fogSun: 0.12,
    };
    this.dawnP = {
      sunDir: new THREE.Vector3(0, 0.004, -1).normalize(),
      sunColor: hdr(0xffb46a, 2.4),
      zenith: hdr(0x1d3a6e, 0.4),
      mid: hdr(0x7a82b0, 0.55),
      horizon: hdr(0xffbf8a, 0.95),
      ground: hdr(0x2a2030, 0.35),
      shape: new THREE.Vector4(0.45, 2.0, 30, 0.35),
      sunGlow: new THREE.Vector4(0.22, 4, 1.1, 140),
      fog: new THREE.Vector4(0.0018, 0.06, WATER_Y, 0.92),
      fogTint: new THREE.Color(1, 1, 1),
      fogSun: 0.5,
    };
    this.atmosphere = new Atmosphere(this.nightP);
    const atm = this.atmosphere;
    this.sky = new Sky(atm, ctx.textures.noise, { stars: 1.4, galaxy: 1.0, sunDiskCos: 0.999992, sunDiskIntensity: 260, clouds: 0.05, cloudColor: hdr(0x40507a, 0.2) });
    this.scene.add(this.sky.mesh);

    this.water = new Water(atm, ctx.textures.noise, WATER_Y, ctx.graphics.hdrType, Math.max(0.25, q.reflectionScale), hdr(0x02040a, 0.4));
    this.scene.add(this.water.mesh);

    const tex = ctx.textures;
    const stone = extendSurface(new THREE.MeshStandardMaterial({ color: 0xd2c6b4, roughness: 0.78, vertexColors: true }), {
      atmosphere: atm,
      textures: tex,
      stoneScale: 0.45,
      variation: 0.15,
      bump: 0.01,
      roughVar: 0.22,
    });
    const dark = extendSurface(new THREE.MeshStandardMaterial({ color: 0x3c3632, roughness: 0.5, vertexColors: true }), {
      atmosphere: atm,
      textures: tex,
      stoneScale: 0.4,
      variation: 0.12,
    });
    const verm = extendSurface(new THREE.MeshStandardMaterial({ color: 0xe4472f, emissive: 0xe4472f, emissiveIntensity: 0.7, roughness: 0.5, vertexColors: true }), { atmosphere: atm });
    const bronze = extendSurface(new THREE.MeshStandardMaterial({ color: 0xa47a4a, roughness: 0.3, metalness: 1, vertexColors: true }), { atmosphere: atm });

    const cs = this.mainFrame.colliders;
    this.mainFrame.killY = -6;
    const b = new Builder(cs, 61);
    // Chaussée : dalles successives (joints visibles), bordures basses.
    const len = START_Z + 4 - (END_Z - 6);
    const zc = (START_Z + 4 + END_Z - 6) / 2;
    b.box({ x: 0, y: -1.6, z: zc, w: 4.4, h: 1.6, d: len, mat: 'stone', r: 0.05, collide: false });
    cs.addBox(0, -0.8, zc, 4.4, 1.6, len);
    for (let z = START_Z + 4; z > END_Z - 6; z -= 3) b.box({ x: 0, y: -0.05, z: z - 1.5, w: 4.2, h: 0.1, d: 2.96, mat: 'stone', r: 0.02, collide: false });
    // bordures : de l'arrivée jusqu'au bord de la plateforme finale
    const curbLen = START_Z - 1 - (END_Z + 6.6);
    const curbZ = (START_Z - 1 + END_Z + 6.6) / 2;
    b.box({ x: -2.35, y: -0.2, z: curbZ, w: 0.3, h: 0.55, d: curbLen, mat: 'stone', r: 0.04 });
    b.box({ x: 2.35, y: -0.2, z: curbZ, w: 0.3, h: 0.55, d: curbLen, mat: 'stone', r: 0.04 });
    b.box({ x: 0, y: 0.05, z: zc, w: 0.18, h: 0.02, d: len, mat: 'verm', collide: false, r: 0.005 });
    // Plateforme finale circulaire
    const plat = new THREE.CylinderGeometry(7, 7, 1.7, 64);
    plat.translate(0, -0.85, 0);
    b.custom(plat, new THREE.Matrix4().makeTranslation(0, 0, END_Z), 'stone', 1);
    plat.dispose();
    cs.addCylinder(0, END_Z, 7, -1.7, 0);
    const disc = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 40);
    b.custom(disc, new THREE.Matrix4().makeTranslation(0, 0.005, END_Z), 'bronze', 1);
    disc.dispose();
    const ringInlay = new THREE.TorusGeometry(5.6, 0.06, 6, 120);
    ringInlay.rotateX(Math.PI / 2);
    b.custom(ringInlay, new THREE.Matrix4().makeTranslation(0, 0.01, END_Z), 'verm', 1);
    ringInlay.dispose();
    // Palier d'arrivée
    b.box({ x: 0, y: -1.7, z: START_Z + 3, w: 12, h: 1.7, d: 8, mat: 'stone', r: 0.05 });
    // Obélisques
    const obGeo = new THREE.CylinderGeometry(0.62, 1.0, 15, 4, 1);
    obGeo.rotateY(Math.PI / 4);
    obGeo.translate(0, 7.5 + WATER_Y, 0);
    const pyr = new THREE.ConeGeometry(0.88, 1.6, 4);
    pyr.rotateY(Math.PI / 4);
    pyr.translate(0, 15 + 0.8 + WATER_Y, 0);
    const baseGeo = new THREE.BoxGeometry(2.6, 1.0, 2.6);
    baseGeo.translate(0, WATER_Y + 0.3, 0);
    for (const z of OBELISK_Z) {
      for (const x of [-11, 11]) {
        const m = new THREE.Matrix4().makeTranslation(x, 0, z);
        b.custom(obGeo, m, 'dark', 1);
        b.custom(pyr, m, 'stone', 1);
        b.custom(baseGeo, m, 'stone', 1);
      }
    }
    obGeo.dispose();
    pyr.dispose();
    baseGeo.dispose();
    for (const m of b.build({ stone, dark, verm, bronze })) this.root.add(m);

    // Fentes lumineuses (face à la chaussée)
    const slitGeo = new THREE.BoxGeometry(0.12, 11, 0.12);
    const nS = OBELISK_Z.length * 2;
    this.slitGlow = new Float32Array(nS);
    slitGeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(this.slitGlow, 1));
    const slitMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { ...atm.uniforms, uColor: { value: hdr(0xffb874, 9) }, uIdle: { value: hdr(0x3a2a20, 0.4) } },
    });
    this.slits = new THREE.InstancedMesh(slitGeo, slitMat, nS);
    let si = 0;
    for (const z of OBELISK_Z) {
      for (const x of [-11, 11]) {
        const face = x < 0 ? 0.62 : -0.62;
        this.slits.setMatrixAt(si, new THREE.Matrix4().makeTranslation(x + face * 0.96, WATER_Y + 7.8, z));
        this.slitTarget.push(0);
        this.lit.push(false);
        si++;
      }
    }
    this.slits.frustumCulled = false;
    this.root.add(this.slits);

    // --- Les deux anneaux d'éclats (parallaxe binoculaire)
    this.ringMat = extendSurface(new THREE.MeshStandardMaterial({ color: 0xe6dccb, roughness: 0.6, emissive: 0x9fb0d8, emissiveIntensity: 0.18 }), {
      atmosphere: atm,
      textures: tex,
      stoneScale: 1.2,
      variation: 0.12,
    });
    // Géométrie simple : à 500 m, les biseaux sont invisibles (12 triangles par éclat).
    const shardGeo = new THREE.BoxGeometry(1, 1, 1);
    const makeRing = (seed: number, count: number) => {
      const rng = new Rng(seed);
      const im = new THREE.InstancedMesh(shardGeo, this.ringMat, count);
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const th = rng.next() * Math.PI * 2;
        const r = RING_R + rng.gauss() * 4.5;
        const s = rng.range(1.2, 6.5);
        m.compose(
          new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r, rng.gauss() * 6),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.next() * 6, rng.next() * 6, rng.next() * 6)),
          new THREE.Vector3(s, s * rng.range(0.4, 1.2), s * rng.range(0.3, 0.9)),
        );
        im.setMatrixAt(i, m);
        const accent = rng.next() < 0.08;
        col.set(accent ? 0xe4472f : 0xffffff).multiplyScalar(accent ? 1 : 0.85 + rng.next() * 0.2);
        im.setColorAt(i, col);
      }
      im.frustumCulled = false;
      const g = new THREE.Group();
      g.add(im);
      g.position.copy(RING_CENTER);
      this.root.add(g);
      return g;
    };
    const nR = Math.round(1100 * Math.max(0.55, q.particleDensity));
    this.ringA = makeRing(101, nR);
    this.ringB = makeRing(202, nR);

    // --- Anneau d'arrivée (le portail de la nuit, refermé)
    this.arrivalRing = new Emblem(atm, GATE_PORTAL_R, 0.47, 1, 0.01, GATE_PORTAL_R + 0.25, 0.1);
    this.arrivalRing.inner.visible = false;
    this.arrivalRing.reveal = 0;
    this.arrivalRing.glow = 1.8;
    this.arrivalRing.group.position.copy(this.arrival.pos);
    this.root.add(this.arrivalRing.group);

    // --- Lumière : lune froide + lueur du point de fuite
    this.setupSun(hdr(0x9fb4e8, 1), 0.9, new THREE.Vector3(0, 0, -50), 80, 300, q.shadowMapSize, q.shadowRadius);
    this.sun.position.set(-60, 120, 40).add(new THREE.Vector3(0, 0, -50));
    this.buildEnvironment(ctx.graphics.renderer);
    this.scene.environmentIntensity = 0.35;

    this.motes = new Motes(atm, Math.round(600 * q.particleDensity), 30, 0.35, 0.06);
    this.motes.material.uniforms.uSunColor = { value: hdr(0xb8c8ff, 0.6) };
    this.scene.add(this.motes.points);

    this.finalAnam = new Anamorphosis({
      name: 'convergence',
      frame: this.mainFrame,
      foot: new THREE.Vector3(0, 0, END_Z),
      focus: new THREE.Vector3(0, WATER_Y + 1.62, RING_CENTER.z),
      sigma: 4,
      hearRadius: 140,
      lockDist: 1.4,
      lockAngleDeg: 20,
    });
    this.anamorphoses.push(this.finalAnam);

    this.spawn = { frame: this.mainFrame, x: 0, y: 0, z: START_Z, yaw: 0, pitch: 0.02 };

    const g = this.grade;
    g.exposure = 1.3;
    g.bloomStrength = 0.16;
    g.bloomThreshold = 0.9;
    g.vignette = 0.42;
    g.lift.setRGB(0.008, 0.012, 0.03);
    g.gain.setRGB(1.0, 1.0, 1.04);
    g.saturation = 1.0;
    g.contrast = 1.05;
  }

  enter(host: StageHost): void {
    super.enter(host);
    this.startTuning();
  }

  exit(): void {
    super.exit();
    this.tuning?.dispose();
    this.tuning = null;
  }

  begin(): void {
    this.startTuning();
    this.host?.hint('Avancez vers le point de fuite.', 6);
  }

  private startTuning(): void {
    const a = this.ctx.audio;
    if (!this.tuning && a.ready && this.phase === 'walk') this.tuning = a.createTuning(new THREE.Vector3(0, 10, END_Z - 60), [45, 52, 59, 62, 66].map(midi));
  }

  musicIntensity(): number {
    return this.phase === 'walk' ? 0.1 + this.progress * 0.85 : 1;
  }

  tickAmbient(dt: number, camera: THREE.Camera): void {
    super.tickAmbient(dt, camera);
    this.ringA.rotation.z += dt * 0.012;
    this.ringB.rotation.z -= dt * 0.009;
    // Convergence : décalage horizontal et vertical qui s'annule.
    const d = 58 * Math.pow(1 - this.converge, 1.15);
    this.ringA.position.set(RING_CENTER.x - d, RING_CENTER.y + d * 0.18, RING_CENTER.z);
    this.ringB.position.set(RING_CENTER.x + d, RING_CENTER.y - d * 0.18, RING_CENTER.z);
    for (let i = 0; i < this.slitGlow.length; i++) this.slitGlow[i] = damp(this.slitGlow[i], this.slitTarget[i], 2.2, dt);
    (this.slits.geometry.attributes.aGlow as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.arrivalRing.update(this.time);
    this.sky.uniforms.uSunDiskCos.value = 1 - 0.000008 * this.sunScale * this.sunScale;
  }

  update(dt: number, camera: THREE.Camera): void {
    super.update(dt, camera);
    const g = this.ctx.graphics;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 70;
    this.motes.update(this.time, camera, g.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)));
    const host = this.host;
    if (!host) return;
    const p = host.player;
    if (this.phase === 'walk') {
      this.progress = clamp((START_Z - p.pos.z) / (START_Z - END_Z));
      this.converge = damp(this.converge, smoothstep(0.02, 1, this.progress), 1.5, dt);
      this.startTuning();
      this.tuning?.update(Math.max(this.finalAnam.alignment, this.converge * 0.6), clamp(0.25 + this.progress));
      // Les obélisques s'allument au passage, chacun avec sa note.
      const notes = [57, 59, 60, 62, 64, 66, 67, 69, 71];
      OBELISK_Z.forEach((z, i) => {
        if (!this.lit[i * 2] && p.pos.z < z + 3) {
          this.lit[i * 2] = this.lit[i * 2 + 1] = true;
          this.slitTarget[i * 2] = this.slitTarget[i * 2 + 1] = 0.35;
          const a = this.ctx.audio;
          if (a.ready) {
            a.inst.bell(midi(notes[i] + 12), a.now(), { gain: 0.05, ratio: 2, index: 0.6, decay: 4, pan: -0.5 });
            a.inst.bell(midi(notes[i] + 19), a.now() + 0.12, { gain: 0.035, ratio: 2, index: 0.5, decay: 4, pan: 0.5 });
          }
        }
      });
      this.sky.uniforms.uSunDisk.value = 260 + this.progress * 300;
      if (this.hintStep === 0 && p.pos.z < END_Z + 10) {
        this.hintStep = 1;
        host.hint('Les deux images n’en font presque plus qu’une. Au centre du cercle, observez.', 7);
      } else if (this.hintStep === 1 && this.playTime > 160) {
        this.hintStep = 2;
        host.hint('Sur le disque de bronze, regardez l’horizon et maintenez {clic}.', 7);
      }
    }
  }

  // ================================================================ Finale
  onLock(): void {
    if (this.phase !== 'walk') return;
    this.phase = 'finale';
    const host = this.host!;
    const audio = this.ctx.audio;
    host.clearHint();
    this.tuning?.resolve();
    host.reach(3);
    const t0 = audio.ready ? audio.music.playFinale(0.08) : -1;
    const beat = audio.ready ? audio.music.beat : 60 / 92;
    const eye = new THREE.Vector3(0, 1.62, END_Z);
    const focus = new THREE.Vector3(0, WATER_Y + 1.62, RING_CENTER.z);
    const conv0 = this.converge;
    const night = this.nightP;
    const dawn = this.dawnP;
    const sunI0 = this.sun.intensity;
    const ex0 = this.grade.exposure;
    const g = this.grade;

    // Horloge du finale : temps audio si disponible (synchronisation exacte).
    const clock = () => (audio.ready && t0 > 0 ? (audio.now() - t0) / beat : seq.t / beat);
    // Plan du finale : poussée sur l'emblème qui se forme, puis grue arrière le long de la
    // chaussée (les obélisques s'embrasent en entrant dans le cadre), enfin un plan fixe
    // en perspective centrale : l'anneau et son reflet composent l'emblème.
    const back = new THREE.Vector3(0, 8.5, -38);
    const backLook = new THREE.Vector3(0, 3.5, RING_CENTER.z);
    const close = new THREE.Vector3(0, 2.4, END_Z + 1.5);
    const tmpP = new THREE.Vector3();
    const tmpL = new THREE.Vector3();
    host.director.play((_t, out) => {
      const bt = clock();
      const k1 = ease.inOutSine(clamp(bt / 6));
      const k2 = ease.inOutCubic(clamp((bt - 6) / 24));
      const drift = Math.max(0, bt - 30);
      tmpP.lerpVectors(eye, close, k1).lerp(back, k2);
      tmpP.y += drift * 0.02;
      out.pos.copy(tmpP);
      cameraZ = tmpP.z;
      tmpL.lerpVectors(focus, backLook, k2);
      lookQuat(out.quat, out.pos, tmpL);
      out.fov = lerp(lerp(72, 62, k1), 50, k2) - drift * 0.05;
    }, 0.6);
    let cameraZ = eye.z;

    const seq = new Sequence();
    seq.at(0, () => {
      host.flash(0.6, 0xfff0d8);
      host.shake(0.35, 1.2);
    });
    // 0 → 4 temps : les deux anneaux fusionnent.
    seq.span(0, beat * 4, (k) => (this.converge = lerp(conv0, 1, ease.outCubic(k))));
    // L'aube remonte la chaussée : les obélisques s'embrasent en rythme, du plus lointain au plus proche.
    // L'aube remonte la chaussée : chaque paire d'obélisques s'embrase quand la caméra l'atteint.
    seq.span(0, beat * 34, () => {
      OBELISK_Z.forEach((z, i) => {
        if (this.slitTarget[i * 2] < 1 && cameraZ > z - 7) {
          this.slitTarget[i * 2] = this.slitTarget[i * 2 + 1] = 1;
          this.slitGlow[i * 2] = this.slitGlow[i * 2 + 1] = 1.6;
          if (audio.ready) audio.inst.bell(midi(81 + (i % 3) * 2), audio.now(), { gain: 0.03, ratio: 2, index: 0.4, decay: 3, pan: 0 });
        }
      });
    });
    seq.at(beat * 31, () => {
      for (let i = 0; i < this.slitTarget.length; i++) this.slitTarget[i] = 1;
    });
    seq.span(beat * 2, beat * 34, (k) => {
      const e = ease.inOutSine(k);
      this.atmosphere.blend(night, dawn, e);
      this.sky.uniforms.uStars.value = lerp(1.4, 0.05, ease.inQuad(k));
      this.sky.uniforms.uGalaxy.value = lerp(1.0, 0, k);
      this.sky.uniforms.uSunDisk.value = lerp(560, 34, e);
      this.sunScale = lerp(1, 8, ease.inOutCubic(k));
      this.sun.intensity = lerp(sunI0, 2.6, e);
      this.sun.color.lerpColors(hdr(0x9fb4e8, 1), hdr(0xffc890, 1), e);
      this.scene.environmentIntensity = lerp(0.35, 1.0, e);
      g.exposure = lerp(ex0, 0.95, e);
      g.saturation = lerp(1.0, 1.12, e);
      g.gain.setRGB(lerp(1.0, 1.04, e), 1.0, lerp(1.04, 0.97, e));
      this.ringMat.emissive.setRGB(1, 0.62, 0.34).multiplyScalar(0.2 + 0.7 * e);
      this.ringMat.emissiveIntensity = 1;
      (this.water.material.uniforms.uDeep.value as THREE.Color).lerpColors(hdr(0x02040a, 0.4), hdr(0x1a1824, 0.5), e);
    });
    // Sommet : temps 32.
    seq.at(beat * 32, () => {
      host.flash(0.9, 0xffe6c0);
      host.shake(0.3, 1.5);
      this.ringMat.emissive.setRGB(1, 0.7, 0.45).multiplyScalar(1.4);
    });
    seq.span(beat * 32, beat * 40, (k) => this.ringMat.emissive.setRGB(1, 0.7, 0.45).multiplyScalar(lerp(1.6, 0.85, ease.outCubic(k))));
    seq.at(beat * 38, () => {
      this.phase = 'end';
      host.finish();
    });
    this.play(seq);
  }

  applyQuality(q: import('../render/Quality').QualityPreset): void {
    super.applyQuality(q);
    this.water.scale = Math.max(0.25, q.reflectionScale);
  }

  preRender(graphics: Graphics, camera: THREE.PerspectiveCamera, w?: number, h?: number): void {
    this.water.render(graphics.renderer, camera, this.scene, w ?? graphics.width, h ?? graphics.height, this.time);
  }

  dispose(): void {
    super.dispose();
    this.water.dispose();
    this.motes.dispose();
    this.arrivalRing.dispose();
  }
}
