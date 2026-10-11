import * as THREE from 'three';
import { Stage, type StageContext, type StageHost } from './Stage';
import { Atmosphere, hdr } from '../render/Atmosphere';
import { Sky } from '../world/Sky';
import { Builder } from '../world/Builder';
import { extendSurface, PaintProjector, TopDownAO, LAYER_OCCLUDER } from '../render/Surface';
import { Anamorphosis } from '../world/Anamorphosis';
import { Emblem } from '../world/Emblem';
import { Portal } from '../world/Portal';
import { Motes, DustBursts } from '../world/Particles';
import { ColliderSet, type BoxCollider, type CylCollider } from '../player/Colliders';
import type { TuningVoice, LoopHandle } from '../audio/AudioEngine';
import { midi } from '../audio/AudioEngine';
import { Sequence } from '../util/Sequence';
import { clamp, ease, lerp } from '../util/math';
import { lookQuat } from '../app/Director';
import type { Graphics } from '../render/Graphics';

/** Extrémité du portail de la Grande Porte (rayon, centre). */
export const GATE_PORTAL_R = 6.3;
export const GATE_PORTAL_POS = new THREE.Vector3(0, GATE_PORTAL_R - 1.2, -55.9);

interface CompElement {
  group: THREE.Group;
  height: number;
  boxes: BoxCollider[];
  cyls: CylCollider[];
  base: THREE.Vector3;
  span: number;
}

/** Chapitre I — Le Seuil : une piazza métaphysique à l'heure dorée. */
export class ThresholdStage extends Stage {
  readonly id = 'threshold';
  readonly chapter = 1;
  paint!: PaintProjector;
  circle!: Anamorphosis;
  private topAO!: TopDownAO;
  private stoneMat!: THREE.MeshStandardMaterial;
  private darkMat!: THREE.MeshStandardMaterial;
  private elements: CompElement[] = [];
  private emblem!: Emblem;
  portal!: Portal;
  private motes!: Motes;
  private dust!: DustBursts;
  private tuning: TuningVoice | null = null;
  private hum: LoopHandle | null = null;
  private eye!: THREE.Vector3;
  private focus!: THREE.Vector3;
  private emblemDist = 14;
  phase: 'search' | 'event' | 'open' | 'gone' = 'search';
  private hintStep = 0;
  private observeHinted = false;
  private openTime = 0;
  private crossedOnce = false;

  build(ctx: StageContext): void {
    this.ctx = ctx;
    const renderer = ctx.graphics.renderer;
    const q = ctx.quality;
    this.musicScene = 'threshold';
    this.reverb = [2.6, 3.2, 0.55];
    this.card = ['Chapitre I', 'Le Seuil', 'Tout commence par un regard.'];
    this.next = 'archipelago';

    this.atmosphere = new Atmosphere({
      sunDir: new THREE.Vector3(-0.86, 0.36, 0.36).normalize(),
      sunColor: hdr(0xffc890, 2.0),
      zenith: hdr(0x2a5878, 0.42),
      mid: hdr(0x9fc4b8, 0.6),
      horizon: hdr(0xf1d9a8, 0.95),
      ground: hdr(0x9c8468, 0.45),
      shape: new THREE.Vector4(0.42, 3.0, 22, 0.12),
      sunGlow: new THREE.Vector4(0.16, 4, 0.9, 260),
      fog: new THREE.Vector4(0.0018, 0.04, 0, 0.92),
      fogTint: new THREE.Color(1, 1, 1),
      fogSun: 0.25,
    });
    this.sky = new Sky(this.atmosphere, ctx.textures.noise, {
      clouds: 0.38,
      cloudColor: hdr(0xfff1dc, 1.3),
      cloudScale: 0.9,
      sunDiskCos: 0.99975,
      sunDiskIntensity: 30,
    });
    this.scene.add(this.sky.mesh);

    // --- Peinture anamorphique : l'emblème vermillon.
    const foot = new THREE.Vector3(7.5, 1.5, 11);
    const eye = foot.clone().add(new THREE.Vector3(0, 1.62, 0));
    const focus = new THREE.Vector3(-2.5, 4.2, -11);
    this.eye = eye;
    this.focus = focus;
    this.paint = new PaintProjector(eye, focus, 50, 0.5, 160, q.shadowMapSize >= 2048 ? 2048 : 1024);
    this.paint.uniforms.uPaintRings.value.set(0.68, 0.05, 0.53, 0.012);
    this.paint.uniforms.uPaintLine.value.set(0, 0.013, 0.98, 0);

    // --- Matériaux
    const atm = this.atmosphere;
    const tex = ctx.textures;
    const stone = extendSurface(
      new THREE.MeshStandardMaterial({ color: 0xd8c9b0, roughness: 0.86, metalness: 0, vertexColors: true }),
      { atmosphere: atm, textures: tex, stoneScale: 0.42, variation: 0.16, bump: 0.01, roughVar: 0.22, paint: this.paint, contactAO: { y: 0, height: 1.6, strength: 0.45 } },
    );
    const ochre = extendSurface(
      new THREE.MeshStandardMaterial({ color: 0xc98a5a, roughness: 0.9, metalness: 0, vertexColors: true }),
      { atmosphere: atm, textures: tex, stoneScale: 0.3, variation: 0.2, bump: 0.008, roughVar: 0.15, contactAO: { y: 0, height: 2.0, strength: 0.4 } },
    );
    const dark = extendSurface(
      new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.22, metalness: 0.0, vertexColors: true }),
      { atmosphere: atm, textures: tex, stoneScale: 0.5, variation: 0.08, bump: 0.002, roughVar: 0.12 },
    );
    const bronze = extendSurface(
      new THREE.MeshStandardMaterial({ color: 0xa47a4a, roughness: 0.32, metalness: 1.0, vertexColors: true }),
      { atmosphere: atm, textures: tex, stoneScale: 1.5, variation: 0.1, bump: 0.002, roughVar: 0.2 },
    );
    this.stoneMat = stone;
    this.darkMat = dark;
    this.topAO = new TopDownAO(-60, -80, 120, 130, 0, q.shadowMapSize >= 2048 ? 1024 : 512);
    const floorMat = extendSurface(new THREE.MeshStandardMaterial({ color: 0xcbb99b, roughness: 0.8, metalness: 0 }), {
      atmosphere: atm,
      textures: tex,
      stoneScale: 0.35,
      variation: 0.14,
      bump: 0.006,
      roughVar: 0.18,
      slabs: { sx: 2.4, sz: 1.6, seam: 0.012, seamDark: 0.35, tileVar: 0.06 },
      paint: this.paint,
      topAO: this.topAO,
    });

    // --- Sol
    const floorGeo = new THREE.PlaneGeometry(1200, 1200, 1, 1);
    floorGeo.rotateX(-Math.PI / 2);
    const uv = floorGeo.attributes.uv as THREE.BufferAttribute;
    const pos = floorGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    floor.layers.enable(LAYER_OCCLUDER);
    floor.name = 'floor';
    this.root.add(floor);

    const cs = this.mainFrame.colliders;
    cs.groundPlane = 0;
    cs.rect = { x0: -33, x1: 33, z0: -58, z1: 30 };
    const b = new Builder(cs, 11);

    // --- Portique d'arrivée (sud) : on y apparaît à l'ombre, face à la place.
    const porticoZ = 23;
    const openings = [];
    for (let i = -3; i <= 3; i++) openings.push({ cx: i * 6, width: 4.2, spring: 5.2 });
    b.archWall({ x: 0, y: 0, z: porticoZ, w: 44, h: 9.5, d: 1.2, openings, mat: 'stone' });
    b.box({ x: 0, y: 0, z: 31.5, w: 46, h: 10, d: 1.2, mat: 'ochre' });
    b.box({ x: 0, y: 9.5, z: 27.2, w: 46, h: 0.9, d: 10, mat: 'stone', collide: false });
    b.box({ x: -22.6, y: 0, z: 27.2, w: 1.2, h: 9.5, d: 9.6, mat: 'stone' });
    b.box({ x: 22.6, y: 0, z: 27.2, w: 1.2, h: 9.5, d: 9.6, mat: 'stone' });
    b.box({ x: 0, y: 10.4, z: 23, w: 46.4, h: 0.5, d: 1.8, mat: 'stone', collide: false, r: 0.08 });

    // --- La composition centrale, disposée le long de l'axe du point de vue :
    // chaque élément intercepte un fragment différent de l'emblème peint.
    const V = eye;
    const dir = focus.clone().sub(V).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const at = (t: number, s: number) => {
      const p = V.clone().addScaledVector(dir, t).addScaledVector(right, s);
      return { x: p.x, z: p.z, face: Math.atan2(V.x - p.x, V.z - p.z) };
    };
    const element = (height: number, span: number, make: (eb: Builder) => void) => {
      const tmp = new ColliderSet();
      const eb = new Builder(tmp, 23 + this.elements.length);
      make(eb);
      const group = new THREE.Group();
      for (const m of eb.build({ stone: this.stoneMat, dark: this.darkMat })) group.add(m);
      this.root.add(group);
      cs.boxes.push(...tmp.boxes);
      cs.cyls.push(...tmp.cyls);
      const base = new THREE.Vector3();
      if (tmp.boxes[0]) base.set(tmp.boxes[0].cx, 0, tmp.boxes[0].cz);
      else if (tmp.cyls[0]) base.set(tmp.cyls[0].cx, 0, tmp.cyls[0].cz);
      this.elements.push({ group, height, boxes: tmp.boxes, cyls: tmp.cyls, base, span });
    };
    const C = (t: number, s: number, h: number, r = 0.55) => {
      const a = at(t, s);
      element(h, 1.2, (eb) => eb.column({ x: a.x, y: 0, z: a.z, h, r, classic: true }));
    };
    const W = (t: number, s: number, w: number, h: number, d: number, twist = 0, mat = 'stone') => {
      const a = at(t, s);
      element(h, w * 0.5, (eb) => eb.box({ x: a.x, y: 0, z: a.z, w, h, d, rotY: a.face + twist, mat, r: 0.06 }));
    };
    W(11, -2.0, 4.2, 1.3, 1.1, 0.25);
    C(14, 4.6, 8.6);
    W(20, -3.6, 4.6, 4.6, 4.6, 0.55);
    C(18.5, -6.2, 9.4, 0.6);
    C(22, 8.4, 9.4, 0.6);
    C(25, -1.8, 9.4, 0.6);
    {
      const l = at(26, 6.5);
      element(2.2, 1.6, (eb) => eb.box({ x: l.x, y: 0, z: l.z, w: 3.2, h: 2.2, d: 1.4, rotY: l.face + 0.9, mat: 'stone', r: 0.05 }));
      const k = at(16, -11.5);
      element(3.4, 1.2, (eb) => eb.box({ x: k.x, y: 0, z: k.z, w: 2.4, h: 3.4, d: 2.4, rotY: 0.3, mat: 'dark', r: 0.05 }));
    }
    W(30, 1.2, 14, 15, 1.0, -0.1);
    W(33, -11.5, 7, 12, 0.9, 0.5);
    {
      const a = at(42, -9.5);
      element(14, 5, (eb) => eb.archWall({ x: a.x, y: 0, z: a.z, w: 10, h: 14, d: 1.6, rotY: a.face, openings: [{ cx: 0, width: 4.4, spring: 6.6 }] }));
      const t = at(40, 12.5);
      element(22, 2.8, (eb) => eb.column({ x: t.x, y: 0, z: t.z, h: 22, r: 2.8, segments: 48 }));
    }

    // --- Belvédère : escalier + plateforme du point de vue
    b.box({ x: 7.5, y: 0, z: 11, w: 3.2, h: 1.5, d: 3.2, mat: 'stone', r: 0.04 });
    b.stairs({ x: 7.5, y: 0, z: 15.6, w: 2.2, steps: 5, rise: 0.3, run: 0.6, rotY: Math.PI, mat: 'stone' });
    const disc = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 40);
    b.custom(disc, new THREE.Matrix4().makeTranslation(foot.x, foot.y + 0.005, foot.z), 'bronze', 1);
    disc.dispose();

    // --- Grande Porte (nord)
    b.archWall({ x: 0, y: 0, z: -58, w: 40, h: 34, d: 3.6, openings: [{ cx: 0, width: 14, spring: 13 }], mat: 'stone' });
    b.box({ x: 0, y: 0, z: -58, w: 44, h: 0.7, d: 7, mat: 'stone', r: 0.05 });
    b.box({ x: 0, y: 34, z: -58, w: 41, h: 1.2, d: 4.6, mat: 'stone', r: 0.08, collide: false });

    // --- Arcades latérales (perspective à la De Chirico)
    for (const side of [-1, 1]) {
      const ops = [];
      for (let i = -6; i <= 6; i++) ops.push({ cx: i * 6.5, width: 4, spring: 4.8 });
      b.archWall({ x: side * 36, y: 0, z: -14, w: 88, h: 11, d: 1.4, rotY: Math.PI / 2, openings: ops, mat: 'ochre' });
      b.box({ x: side * 43, y: 0, z: -14, w: 1.2, h: 13, d: 88, mat: 'ochre' });
      b.box({ x: side * 39.5, y: 11, z: -14, w: 8.6, h: 1, d: 88.4, mat: 'stone', collide: false });
    }

    // --- Lointains
    b.column({ x: -70, y: 0, z: -140, h: 46, r: 3.2, segments: 32, collide: false, mat: 'ochre' });
    b.box({ x: -70, y: 46, z: -140, w: 8, h: 3, d: 8, collide: false, mat: 'ochre' });
    b.column({ x: 60, y: 0, z: -190, h: 70, r: 4.5, segments: 32, collide: false, mat: 'stone' });
    b.box({ x: 20, y: 0, z: -160, w: 60, h: 18, d: 12, collide: false, mat: 'stone' });
    b.box({ x: -40, y: 0, z: -230, w: 90, h: 26, d: 14, collide: false, mat: 'ochre' });

    for (const m of b.build({ stone, ochre, dark, bronze })) this.root.add(m);

    // --- Lumière
    this.setupSun(hdr(0xffd7a8, 1), 5.5, new THREE.Vector3(0, 0, -16), 66, 240, q.shadowMapSize, q.shadowRadius);
    this.buildEnvironment(renderer);
    this.scene.environmentIntensity = 0.85;

    // Cartes préalables : profondeur du projecteur, occlusion vue du dessus.
    this.paint.renderDepth(renderer, this.scene);
    this.topAO.render(renderer, this.scene);

    // --- L'emblème matérialisé (invisible jusqu'au verrouillage)
    const tanH = Math.tan(THREE.MathUtils.degToRad(25));
    const D = this.emblemDist;
    const wr = (n: number) => n * D * tanH;
    this.emblem = new Emblem(atm, wr(0.68), wr(0.05), wr(0.53), wr(0.012), wr(0.98), wr(0.013));
    this.emblem.group.position.copy(eye).addScaledVector(dir, D);
    this.emblem.group.lookAt(eye);
    this.emblem.group.visible = false;
    this.root.add(this.emblem.group);

    // --- Portail de la Grande Porte (vers l'Archipel)
    this.portal = new Portal(GATE_PORTAL_R, ctx.graphics.hdrType);
    this.portal.setResolution(ctx.graphics.width, ctx.graphics.height, q.portalScale);
    this.root.add(this.portal.mesh);

    // --- Particules
    this.motes = new Motes(atm, Math.round(700 * q.particleDensity), 24, 0.22, 0.05);
    this.scene.add(this.motes.points);
    this.dust = new DustBursts(atm, 900);
    this.scene.add(this.dust.points);

    this.circle = new Anamorphosis({ name: 'cercle', frame: this.mainFrame, foot, focus, sigma: 3.2, hearRadius: 40 });
    this.anamorphoses.push(this.circle);

    this.spawn = { frame: this.mainFrame, x: 0, y: 0, z: 29, yaw: 0, pitch: 0.03 };

    const g = this.grade;
    g.exposure = 1.0;
    g.bloomStrength = 0.08;
    g.bloomThreshold = 1.4;
    g.vignette = 0.32;
    g.lift.setRGB(0.012, 0.01, 0.02);
    g.gain.setRGB(1.02, 1.0, 0.97);
    g.saturation = 1.04;
    g.contrast = 1.03;
  }

  /** Branche le portail sur la scène de destination. */
  private linkPortal(): void {
    const dest = this.ctx.stage('archipelago') as (Stage & { arrival?: { pos: THREE.Vector3; yaw: number } }) | undefined;
    if (!dest?.arrival) return;
    this.portal.setEnds(GATE_PORTAL_POS, 0, dest.arrival.pos, dest.arrival.yaw);
  }

  private startTuning(): void {
    if (!this.tuning && this.ctx.audio.ready && this.phase === 'search') {
      // Accord de ré lydien : D3 A3 E4 G#4 C#5
      this.tuning = this.ctx.audio.createTuning(this.focus, [50, 57, 64, 68, 73].map(midi));
    }
  }

  enter(host: StageHost): void {
    super.enter(host);
    this.startTuning();
  }

  exit(): void {
    super.exit();
    this.tuning?.dispose();
    this.tuning = null;
    this.hum?.stop(2);
    this.hum = null;
  }

  begin(): void {
    this.startTuning();
    if (this.phase === 'search') this.host?.hint('Explorez la place. {keys} pour marcher, la souris pour regarder.', 7);
  }

  musicIntensity(): number {
    if (this.phase === 'search') return this.circle.alignment * 0.25;
    if (this.phase === 'event') return 0.55;
    return 0.45;
  }

  tickAmbient(dt: number, camera: THREE.Camera): void {
    super.tickAmbient(dt, camera);
    this.emblem.update(this.time);
  }

  update(dt: number, camera: THREE.Camera): void {
    super.update(dt, camera);
    const host = this.host;
    const g = this.ctx.graphics;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 70;
    const pixel = g.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.motes.update(this.time, camera, pixel);
    this.dust.update(dt, pixel);

    if (this.phase === 'search') {
      this.startTuning();
      this.tuning?.update(this.circle.alignment, this.circle.proximity);
      if (host) this.updateHints(host);
    }
    if (this.phase === 'open' && host) {
      this.openTime += dt;
      if (this.openTime > 35 && this.hintStep < 10) {
        this.hintStep = 10;
        host.hint('L’anneau attend au pied de la Grande Porte.', 6);
      }
      if (!this.crossedOnce && this.portal.crossed(camera.position)) {
        this.crossedOnce = true;
        this.crossToArchipelago();
      }
    }
  }

  private updateHints(host: StageHost): void {
    const t = this.playTime;
    const a = this.circle;
    if (!this.observeHinted && a.alignment > 0.55 && a.distance < 3) {
      this.observeHinted = true;
      host.hint('Vous y êtes presque. Maintenez {clic} pour <em>observer</em>.', 6);
      return;
    }
    if (this.hintStep === 0 && t > 22) {
      this.hintStep = 1;
      host.hint('Un cercle se cache dans la place. Il n’existe que vu d’un seul endroit.', 7);
    } else if (this.hintStep === 1 && t > 55 && a.distance > 6) {
      this.hintStep = 2;
      host.hint('Écoutez : l’accord se purifie quand vous approchez du bon point de vue.', 7);
    } else if (this.hintStep === 2 && t > 90 && a.distance > 4) {
      this.hintStep = 3;
      host.hint('Le belvédère, à droite de la place, domine la composition.', 7);
    } else if (this.hintStep === 3 && t > 135 && a.distance > 2) {
      this.hintStep = 4;
      host.hint('Montez sur la plateforme au disque de bronze et regardez vers les colonnes.', 8);
    }
  }

  // ================================================================ Événement
  onLock(): void {
    if (this.phase !== 'search') return;
    this.phase = 'event';
    const host = this.host!;
    const audio = this.ctx.audio;
    const player = host.player;
    host.clearHint();
    this.linkPortal();
    this.tuning?.resolve();
    this.shadowLive = true;
    const eye = this.eye.clone();
    const focus = this.focus.clone();
    const em = this.emblem;
    const startPos = em.group.position.clone();
    const startQuat = em.group.quaternion.clone();
    const endPos = GATE_PORTAL_POS.clone();
    const endQuat = new THREE.Quaternion();
    const scale1 = GATE_PORTAL_R / em.radius;
    const barHalf0 = em.radius * (0.98 / 0.68);
    const pu = this.paint.uniforms;
    const inst = audio.ready ? audio.inst : null;

    // Plans de caméra : point de vue → grue au-dessus de la place → travelling vers la porte.
    const eyeQuat = lookQuat(new THREE.Quaternion(), eye, focus);
    const craneTo = new THREE.Vector3(24, 16, 20);
    const lookA = focus.clone();
    const lookB = new THREE.Vector3(-3, 6, -30);
    let camPhase = 0;
    let camT = 0;
    const gateCamTo = new THREE.Vector3(6, 4.5, -26);
    host.director.play((t, out) => {
      if (camPhase === 0) {
        out.pos.copy(eye);
        out.quat.copy(eyeQuat);
        out.fov = 72;
        return;
      }
      if (camPhase === 1) {
        const k = ease.inOutCubic(clamp((t - camT) / 5.5));
        out.pos.lerpVectors(eye, craneTo, k);
        out.pos.y += Math.sin(k * Math.PI) * 3;
        const look = new THREE.Vector3().lerpVectors(lookA, lookB, ease.inOutQuad(k));
        look.lerp(em.group.position, 0.35 * k);
        lookQuat(out.quat, out.pos, look);
        out.fov = lerp(72, 64, k);
        return;
      }
      const k = ease.inOutCubic(clamp((t - camT) / 4.5));
      out.pos.lerpVectors(craneTo, gateCamTo, k);
      const look = new THREE.Vector3().lerpVectors(new THREE.Vector3(-2, 6, -34), endPos, k);
      lookQuat(out.quat, out.pos, look);
      out.fov = lerp(64, 58, k);
    }, 0.5);

    const seq = new Sequence();
    seq.at(0, () => {
      if (inst) {
        inst.boom(audio.now(), 0.35, 55);
        [62, 69, 74, 78, 81, 85].forEach((n, i) => inst.bell(midi(n), audio.now() + 0.05 + i * 0.06, { gain: 0.045, ratio: 3.5, index: 1.0, decay: 5, pan: i / 5 - 0.5 }));
        inst.pad([50, 57, 62, 66, 69, 73].map(midi), audio.now(), 6, { gain: 0.12, attack: 0.08, release: 6, cutoff: 2400 });
      }
      host.flash(0.35, 0xffd2a0);
      host.shake(0.25, 0.8);
    });
    seq.span(0, 1.1, (k) => (pu.uPaintGlow.value = ease.outCubic(k) * 3.2));
    seq.at(1.0, () => {
      em.group.visible = true;
      em.reveal = 1;
      inst?.riser(audio.now(), 1.7, 0.08, 500, 8000);
    });
    seq.span(1.0, 2.8, (k) => {
      const e = ease.inOutQuad(k);
      pu.uPaintSweep.value = 1 - e;
      em.reveal = 1 - e;
    });
    seq.at(2.8, () => {
      pu.uPaintAmount.value = 0;
      camPhase = 1;
      camT = seq.t;
      inst?.whoosh(2.2, 0.06);
    });
    // L'architecture s'enfonce dans le sol, élément après élément.
    this.elements.forEach((el, i) => {
      const t0 = 3.2 + i * 0.32;
      const dur = 2.4 + el.height * 0.06;
      seq.at(t0, () => {
        for (const bx of el.boxes) bx.enabled = false;
        for (const c of el.cyls) c.enabled = false;
        if (audio.ready) audio.inst.rumble(el.base.clone().setY(1), dur, 0.16 + Math.min(0.2, el.height * 0.012));
        this.dust.burst(el.base.clone(), new THREE.Vector3(el.span + 0.8, 0.4, el.span + 0.8), 26, 1.6, 2.2, 3.6);
      });
      seq.span(t0, t0 + dur, (k) => {
        const e = ease.inQuad(k);
        el.group.position.y = -e * (el.height + 0.6);
        el.group.position.x = Math.sin(k * 80 + i) * 0.015 * (1 - k);
        el.group.visible = k < 1;
      });
    });
    // L'emblème rejoint la Grande Porte.
    const ctrl = new THREE.Vector3().lerpVectors(startPos, endPos, 0.5).add(new THREE.Vector3(0, 14, 0));
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    seq.span(3.4, 9.6, (k) => {
      const e = ease.inOutCubic(k);
      pa.lerpVectors(startPos, ctrl, e);
      pb.lerpVectors(ctrl, endPos, e);
      em.group.position.lerpVectors(pa, pb, e);
      em.group.quaternion.copy(startQuat).slerp(endQuat, ease.inOutQuad(k));
      em.group.rotateZ(ease.inOutQuad(k) * Math.PI * 2);
      const s = lerp(1, scale1, e);
      em.group.scale.setScalar(s);
      em.inner.scale.setScalar(Math.max(0.001, 1 - ease.inQuad(k)));
      em.bar.scale.x = lerp(1, (GATE_PORTAL_R + 0.25) / (barHalf0 * scale1), e);
      this.hum?.setPosition(em.group.position);
    });
    seq.at(3.4, () => {
      if (audio.ready) this.hum = audio.inst.hum(em.group.position.clone(), [73.42, 110, 146.83, 220], 0.1);
    });
    seq.at(9.0, () => {
      camPhase = 2;
      camT = seq.t;
    });
    seq.at(9.6, () => {
      em.inner.visible = false;
      if (inst) {
        inst.boom(audio.now(), 0.55, 42);
        inst.timpani(midi(38), audio.now(), 0.3);
        inst.riser(audio.now(), 2.4, 0.07, 300, 9000);
      }
      host.shake(0.45, 1.2);
      host.flash(0.25, 0xffb080);
      this.dust.burst(new THREE.Vector3(0, 0.2, -55.5), new THREE.Vector3(6, 0.3, 1.5), 60, 2.2, 2.8, 4);
      this.portal.enabled = true;
    });
    seq.span(9.6, 12.4, (k) => (this.portal.open = ease.outCubic(k)));
    seq.at(13.4, () => host.director.release(2.0));
    seq.at(15.2, () => {
      this.shadowLive = false;
      this.shadowDirty = true;
      this.phase = 'open';
      player.frozen = false;
      host.hint('Le passage est ouvert. Traversez l’anneau.', 6);
    });
    this.play(seq);
  }

  private crossToArchipelago(): void {
    const host = this.host;
    if (!host) return;
    const portal = this.portal;
    this.phase = 'gone';
    this.hum?.stop(3);
    this.hum = null;
    host.advanceSeamless('archipelago', (player) => {
      const dest = this.ctx.stage('archipelago')!;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      player.computeWorldPose(pos, quat);
      portal.transferPose(pos, quat);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      const pitch = Math.asin(clamp(fwd.y, -1, 1));
      player.teleport(dest.mainFrame, pos.x, pos.y - player.eyeHeight, pos.z, yaw, pitch);
    });
  }

  preRender(graphics: Graphics, camera: THREE.PerspectiveCamera): void {
    if (!this.portal.enabled) return;
    const dest = this.ctx.stage('archipelago');
    if (!dest) return;
    dest.tickAmbient(1 / 60, this.portal.vcam);
    const r = graphics.renderer;
    const sm = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false;
    this.portal.setResolution(graphics.width, graphics.height, this.ctx.quality.portalScale);
    this.portal.render(r, camera, dest.scene, this.time, graphics.width, graphics.height);
    r.shadowMap.needsUpdate = sm;
    this.portal.material.uniforms.uExposure.value = dest.grade.exposure / this.grade.exposure;
  }

  dispose(): void {
    super.dispose();
    this.paint.dispose();
    this.topAO.dispose();
    this.portal.dispose();
    this.motes.dispose();
    this.dust.dispose();
    this.emblem.dispose();
  }
}
