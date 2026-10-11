import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Stage, type StageContext } from './Stage';
import { Atmosphere, hdr } from '../render/Atmosphere';
import { Sky } from '../world/Sky';
import { extendSurface } from '../render/Surface';
import { Rng, clamp, damp, ease, lerp } from '../util/math';
import { lookQuat, type CamPose } from '../app/Director';

/**
 * Écran-titre : le mot PARALLAX est une sculpture d'éclats dispersés en profondeur.
 * Il n'est lisible que depuis le point de vue de la caméra ; la souris déplace ce
 * point de vue et le mot se disloque.
 */
export class TitleStage extends Stage {
  readonly id = 'title';
  readonly chapter = 0;
  private shards!: THREE.InstancedMesh;
  private dust!: THREE.InstancedMesh;
  /** Décalage de caméra courant (lissé). */
  private offset = new THREE.Vector3(7, 2.5, 4);
  private mouse = new THREE.Vector2();
  private introT = 0;
  private diveT = -1;
  readonly baseFov = 38;
  private tanHalfX = 0;
  diving = false;
  /** 0 → 1 pendant la plongée (pour le fondu piloté par l'application). */
  diveProgress = 0;

  build(ctx: StageContext): void {
    this.ctx = ctx;
    const rng = new Rng(2026);
    this.atmosphere = new Atmosphere({
      sunDir: new THREE.Vector3(-0.25, 0.03, -0.97).normalize(),
      sunColor: hdr(0xff8a4a, 1.0),
      zenith: hdr(0x05060a, 0.3),
      mid: hdr(0x130f16, 0.45),
      horizon: hdr(0x3a2016, 0.28),
      ground: hdr(0x0b0909, 0.1),
      shape: new THREE.Vector4(0.45, 2.5, 30, 0.6),
      sunGlow: new THREE.Vector4(0.035, 4, 0.12, 30),
      fog: new THREE.Vector4(0.002, 0.01, 0, 0.75),
      fogTint: new THREE.Color(0.7, 0.68, 0.75),
      fogSun: 0.15,
    });
    this.sky = new Sky(this.atmosphere, ctx.textures.noise, { clouds: 0.25, cloudColor: hdr(0x8a6a66, 0.5), cloudScale: 0.7, sunDiskIntensity: 0 });
    this.scene.add(this.sky.mesh);

    // --- Échantillonnage du mot dans un canevas
    const W = 1800;
    const H = 360;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `500 ${Math.round(H * 0.82)}px Cormorant, 'Cormorant Garamond', Georgia, serif`;
    // espacement des lettres simulé
    const word = 'PARALLAX';
    const spacing = H * 0.14;
    const widths = [...word].map((c) => g.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (word.length - 1);
    let x = W / 2 - total / 2;
    for (let i = 0; i < word.length; i++) {
      g.fillText(word[i], x + widths[i] / 2, H * 0.53);
      x += widths[i] + spacing;
    }
    const img = g.getImageData(0, 0, W, H).data;
    const step = Math.round(H / 34);
    const samples: { u: number; v: number }[] = [];
    for (let py = 0; py < H; py += step) {
      for (let px = 0; px < W; px += step) {
        const jx = px + (rng.next() - 0.5) * step * 0.3;
        const jy = py + (rng.next() - 0.5) * step * 0.3;
        const ix = Math.min(W - 1, Math.max(0, Math.round(jx)));
        const iy = Math.min(H - 1, Math.max(0, Math.round(jy)));
        if (img[(iy * W + ix) * 4] > 128) samples.push({ u: jx / W, v: jy / H });
      }
    }

    // Le mot occupe une largeur fixe dans l'espace « tangente » de la caméra.
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    const wordTanW = tanY * 2 * 1.3; // largeur du mot (unités tangentes)
    this.tanHalfX = wordTanW / 2 / 0.82;
    const wordTanH = (wordTanW * H) / W;
    const cellTan = (wordTanW * step) / W;
    const centerY = tanY * 0.2;

    const geo = new RoundedBoxGeometry(1, 1, 0.35, 1, 0.12);
    const mat = extendSurface(new THREE.MeshStandardMaterial({ color: 0xe8dccb, roughness: 0.55, metalness: 0 }), {
      atmosphere: this.atmosphere,
      textures: ctx.textures,
      stoneScale: 2.5,
      variation: 0.12,
      bump: 0.004,
      roughVar: 0.3,
    });
    const density = ctx.quality.particleDensity;
    const n = samples.length;
    this.shards = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const verm = new THREE.Color(0xe4472f);
    const bone = new THREE.Color(0xffffff);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const tx = (s.u - 0.5) * wordTanW;
      const ty = centerY + (0.5 - s.v) * wordTanH;
      const depth = lerp(9, 46, Math.pow(rng.next(), 0.8));
      p.set(tx * depth, ty * depth, -depth);
      const size = cellTan * depth * (1.22 + rng.next() * 0.35);
      lookQuat(q, p, new THREE.Vector3(0, 0, 0));
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((rng.next() - 0.5) * 0.5, (rng.next() - 0.5) * 0.5, rng.next() * Math.PI)));
      sc.set(size, size * (0.8 + rng.next() * 0.4), size * (0.6 + rng.next() * 0.8));
      m.compose(p, q, sc);
      this.shards.setMatrixAt(i, m);
      const accent = rng.next() < 0.07;
      col.copy(accent ? verm : bone).multiplyScalar(accent ? 1 : 0.88 + rng.next() * 0.16);
      this.shards.setColorAt(i, col);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
    this.shards.frustumCulled = false;
    this.root.add(this.shards);

    // --- Poussière d'éclats hors du mot (profondeur, matière)
    const dn = Math.round(900 * density);
    this.dust = new THREE.InstancedMesh(geo, mat, dn);
    for (let i = 0; i < dn; i++) {
      const depth = lerp(6, 90, Math.pow(rng.next(), 1.4));
      const ang = rng.next() * Math.PI * 2;
      const rad = (0.35 + rng.next() * 1.4) * depth * 0.9;
      p.set(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.55 + depth * 0.05, -depth - 4);
      const size = 0.08 + rng.next() * 0.5 * (depth / 40);
      q.setFromEuler(new THREE.Euler(rng.next() * 6, rng.next() * 6, rng.next() * 6));
      sc.set(size, size * (0.5 + rng.next()), size * (0.3 + rng.next() * 0.6));
      m.compose(p, q, sc);
      this.dust.setMatrixAt(i, m);
      col.copy(rng.next() < 0.05 ? verm : bone).multiplyScalar(0.7 + rng.next() * 0.3);
      this.dust.setColorAt(i, col);
    }
    this.dust.instanceMatrix.needsUpdate = true;
    if (this.dust.instanceColor) this.dust.instanceColor.needsUpdate = true;
    this.dust.frustumCulled = false;
    this.root.add(this.dust);

    // --- Monolithes lointains (silhouettes)
    const monoGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.02);
    const monoMat = extendSurface(new THREE.MeshStandardMaterial({ color: 0x3a332d, roughness: 0.8 }), {
      atmosphere: this.atmosphere,
      textures: ctx.textures,
      stoneScale: 0.2,
      variation: 0.1,
    });
    const monos: [number, number, number, number, number, number][] = [
      [-240, -60, -520, 18, 210, 18],
      [260, -80, -600, 26, 240, 26],
    ];
    for (const [mx, my, mz, w, h, d] of monos) {
      const mm = new THREE.Mesh(monoGeo, monoMat);
      mm.position.set(mx, my + h / 2, mz);
      mm.scale.set(w, h, d);
      mm.rotation.y = rng.next();
      this.root.add(mm);
    }

    // --- Lumières
    const key = new THREE.DirectionalLight(hdr(0xffd2a8, 1), 4.2);
    key.position.set(-12, 14, 30);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(hdr(0xff7a4a, 1), 3.0);
    rim.position.set(25, 10, -60);
    this.scene.add(rim);
    this.sun = key;
    this.buildEnvironment(ctx.graphics.renderer);
    this.scene.environmentIntensity = 0.5;

    const gr = this.grade;
    gr.exposure = 1.05;
    gr.bloomStrength = 0.12;
    gr.bloomThreshold = 1.0;
    gr.vignette = 0.5;
    gr.lift.setRGB(0.02, 0.012, 0.016);
    gr.saturation = 1.0;
    gr.contrast = 1.04;
    this.far = 900;
    this.spawn = { frame: this.mainFrame, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  }

  setMouse(nx: number, ny: number): void {
    this.mouse.set(nx, ny);
  }

  /** Saute l'apparition (tests). */
  skipIntro(): void {
    this.introT = 12;
    this.offset.set(0, 0, 0);
  }

  /** Recommence l'apparition du titre (le mot se compose). */
  resetIntro(): void {
    this.introT = 0;
    this.diveT = -1;
    this.diving = false;
    this.diveProgress = 0;
    this.offset.set(7, 2.5, 4);
  }

  dive(): void {
    if (this.diving) return;
    this.diving = true;
    this.diveT = 0;
  }

  update(dt: number, camera: THREE.Camera): void {
    super.update(dt, camera);
    this.introT += dt;
    if (this.diveT >= 0) this.diveT += dt;
    // Légère rotation des éclats de poussière.
    this.dust.rotation.z += dt * 0.004;
    this.dust.rotation.y = Math.sin(this.time * 0.05) * 0.03;
  }

  /** Pose de la caméra du titre (pilotée par le réalisateur). */
  cameraPose(dt: number, out: CamPose, aspect: number): void {
    const t = this.introT;
    // Apparition : la caméra glisse jusqu'au point de vue exact (le mot se forme).
    const k = ease.inOutCubic(clamp((t - 0.4) / 5.2));
    const drift = new THREE.Vector3(Math.sin(t * 0.21) * 0.35, Math.sin(t * 0.17 + 1) * 0.2, 0);
    const target = new THREE.Vector3(this.mouse.x * 1.1, -this.mouse.y * 0.6, 0).add(drift);
    const intro = new THREE.Vector3(7, 2.5, 4).multiplyScalar(1 - k);
    target.add(intro);
    this.offset.x = damp(this.offset.x, target.x, 2.2, dt);
    this.offset.y = damp(this.offset.y, target.y, 2.2, dt);
    this.offset.z = damp(this.offset.z, target.z, 2.2, dt);
    out.pos.copy(this.offset);
    let lookAt = new THREE.Vector3(0, 0, -30);
    if (this.diveT >= 0) {
      const d = this.diveT;
      const dk = ease.inCubic(clamp(d / 2.6));
      out.pos.z -= dk * 70;
      out.pos.y += dk * 2;
      lookAt = lookAt.clone().add(new THREE.Vector3(0, 0, -dk * 70));
      this.diveProgress = clamp(d / 2.6);
    }
    lookQuat(out.quat, out.pos, lookAt);
    // Le mot doit tenir horizontalement quel que soit le format d'écran.
    const needY = (2 * Math.atan(this.tanHalfX / Math.max(0.5, aspect)) * 180) / Math.PI;
    out.fov = Math.max(this.baseFov, needY) + (this.diveT >= 0 ? ease.inQuad(clamp(this.diveT / 2.6)) * 30 : 0);
  }
}
