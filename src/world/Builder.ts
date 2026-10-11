import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ColliderSet, Surface } from '../player/Colliders';
import { LAYER_OCCLUDER } from '../render/Surface';
import { Rng } from '../util/math';

// Construction procédurale de l'architecture : chaque pièce est transformée,
// reçoit des UV projetées en mètres et une teinte légèrement variée, puis tout
// est fusionné par matériau (quelques appels de dessin seulement).

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

export interface BoxSpec {
  x: number;
  /** Altitude de la base (pas du centre). */
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rotY?: number;
  /** Rayon du biseau des arêtes. */
  r?: number;
  mat?: string;
  collide?: boolean;
  tint?: number;
  safe?: boolean;
  surface?: Surface;
  occluder?: boolean;
}

export interface ColumnSpec {
  x: number;
  y: number;
  z: number;
  h: number;
  r: number;
  mat?: string;
  collide?: boolean;
  /** Profil classique (base, fût galbé, chapiteau) ou cylindre simple. */
  classic?: boolean;
  segments?: number;
  tint?: number;
}

export interface ArchWallSpec {
  x: number;
  y: number;
  z: number;
  /** Longueur (axe X local). */
  w: number;
  h: number;
  /** Épaisseur (axe Z local). */
  d: number;
  rotY?: number;
  /** Ouvertures en arc : centre (x local), largeur, hauteur des piédroits. */
  openings: { cx: number; width: number; spring: number }[];
  mat?: string;
  collide?: boolean;
  tint?: number;
}

/** Ajoute un attribut de couleur blanc (pour les matériaux à couleurs de sommet). */
export function withWhite<T extends THREE.BufferGeometry>(geo: T): T {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3).fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

export class Builder {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private occluderParts = new Map<string, boolean>();
  readonly rng: Rng;
  /** Teinte de base et dispersion appliquées aux couleurs de sommet. */
  tintSpread = 0.05;

  constructor(
    readonly colliders: ColliderSet | null,
    seed = 7,
  ) {
    this.rng = new Rng(seed);
  }

  /** Ajoute une géométrie (clonée) transformée par `matrix`. */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, mat = 'stone', tint?: number, color?: THREE.Color): void {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g = this.worldUV(g);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const t = tint ?? 1 + (this.rng.next() - 0.5) * 2 * this.tintSpread;
    const warm = (this.rng.next() - 0.5) * this.tintSpread * 0.5;
    const c = color ?? new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r * t * (1 + warm);
      col[i * 3 + 1] = c.g * t;
      col[i * 3 + 2] = c.b * t * (1 - warm);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let list = this.parts.get(mat);
    if (!list) {
      list = [];
      this.parts.set(mat, list);
    }
    list.push(g);
  }

  /** UV projetées dans l'espace monde (en mètres) selon l'axe dominant de la normale. */
  private worldUV(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));
      if (ny >= nx && ny >= nz) {
        uv[i * 2] = x;
        uv[i * 2 + 1] = z;
      } else if (nx >= nz) {
        uv[i * 2] = z + 13.7;
        uv[i * 2 + 1] = y;
      } else {
        uv[i * 2] = x + 7.3;
        uv[i * 2 + 1] = y;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }

  box(s: BoxSpec): void {
    const r = Math.min(s.r ?? 0.05, s.w / 2, s.h / 2, s.d / 2);
    const geo = r > 0.004 ? new RoundedBoxGeometry(s.w, s.h, s.d, 1, r) : new THREE.BoxGeometry(s.w, s.h, s.d);
    _e.set(0, s.rotY ?? 0, 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(s.x, s.y + s.h / 2, s.z), _q, _s.set(1, 1, 1));
    this.add(geo, _m, s.mat, s.tint);
    geo.dispose();
    if (s.collide !== false && this.colliders) {
      this.colliders.addBox(s.x, s.y + s.h / 2, s.z, s.w, s.h, s.d, {
        rotY: s.rotY ?? 0,
        safe: s.safe ?? true,
        surface: s.surface ?? 'stone',
      });
    }
  }

  column(s: ColumnSpec): void {
    const seg = s.segments ?? 28;
    let geo: THREE.BufferGeometry;
    if (s.classic) {
      const r = s.r;
      const h = s.h;
      const pts: THREE.Vector2[] = [];
      const P = (rr: number, yy: number) => pts.push(new THREE.Vector2(rr, yy));
      // plinthe
      P(0, 0);
      P(r * 1.42, 0);
      P(r * 1.42, h * 0.035);
      P(r * 1.3, h * 0.04);
      // tore de base
      for (let i = 0; i <= 6; i++) {
        const a = -Math.PI / 2 + (i / 6) * Math.PI;
        P(r * 1.12 + Math.cos(a) * r * 0.16, h * 0.058 + Math.sin(a) * h * 0.018);
      }
      P(r * 1.04, h * 0.08);
      // fût avec entasis
      const shaft0 = h * 0.085;
      const shaft1 = h * 0.88;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const ent = 1 - 0.12 * t * t + 0.03 * Math.sin(t * Math.PI);
        P(r * ent, shaft0 + (shaft1 - shaft0) * t);
      }
      // échine et abaque
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        P(r * (0.9 + 0.45 * Math.sin(t * Math.PI * 0.5)), shaft1 + h * 0.045 * t);
      }
      P(r * 1.45, h * 0.93);
      P(r * 1.45, h);
      P(0, h);
      geo = new THREE.LatheGeometry(pts, seg);
    } else {
      geo = new THREE.CylinderGeometry(s.r, s.r, s.h, seg, 1, false);
      geo.translate(0, s.h / 2, 0);
    }
    _m.makeTranslation(s.x, s.y, s.z);
    this.add(geo, _m, s.mat, s.tint);
    geo.dispose();
    if (s.collide !== false && this.colliders) {
      this.colliders.addCylinder(s.x, s.z, s.r * (s.classic ? 1.2 : 1), s.y, s.y + s.h);
    }
  }

  /** Escalier : `steps` marches montant vers +Z local à partir de (x, y, z). */
  stairs(s: {
    x: number;
    y: number;
    z: number;
    w: number;
    steps: number;
    rise: number;
    run: number;
    rotY?: number;
    mat?: string;
    r?: number;
  }): void {
    const rot = s.rotY ?? 0;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let i = 0; i < s.steps; i++) {
      const lz = s.run * (i + 0.5);
      // la marche i va du sol jusqu'à sa hauteur (bloc plein)
      const h = s.rise * (i + 1);
      const wx = s.x + lz * sn;
      const wz = s.z + lz * c;
      this.box({ x: wx, y: s.y, z: wz, w: s.w, h, d: s.run, rotY: rot, mat: s.mat, r: s.r ?? 0.02, tint: 1 });
    }
  }

  /** Mur percé d'arcades (forme extrudée). */
  archWall(s: ArchWallSpec): void {
    const shape = new THREE.Shape();
    const hw = s.w / 2;
    shape.moveTo(-hw, 0);
    shape.lineTo(hw, 0);
    shape.lineTo(hw, s.h);
    shape.lineTo(-hw, s.h);
    shape.lineTo(-hw, 0);
    for (const o of s.openings) {
      const r = o.width / 2;
      const hole = new THREE.Path();
      hole.moveTo(o.cx - r, 0.0001);
      hole.lineTo(o.cx - r, o.spring);
      hole.absarc(o.cx, o.spring, r, Math.PI, 0, true);
      hole.lineTo(o.cx + r, 0.0001);
      hole.lineTo(o.cx - r, 0.0001);
      shape.holes.push(hole);
    }
    const bevel = Math.min(0.06, s.d * 0.1);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: s.d - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 20,
    });
    geo.translate(0, 0, -(s.d - bevel * 2) / 2);
    _e.set(0, s.rotY ?? 0, 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(1, 1, 1));
    this.add(geo, _m, s.mat, s.tint);
    geo.dispose();
    if (s.collide !== false && this.colliders) {
      // piliers pleins entre les ouvertures
      const ops = [...s.openings].sort((a, b) => a.cx - b.cx);
      let cursor = -hw;
      const rot = s.rotY ?? 0;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const addSeg = (x0: number, x1: number) => {
        if (x1 - x0 < 0.05) return;
        const lx = (x0 + x1) / 2;
        const wx = s.x + lx * c;
        const wz = s.z - lx * sn;
        this.colliders!.addBox(wx, s.y + s.h / 2, wz, x1 - x0, s.h, s.d, { rotY: rot });
      };
      for (const o of ops) {
        addSeg(cursor, o.cx - o.width / 2);
        cursor = o.cx + o.width / 2;
      }
      addSeg(cursor, hw);
    }
  }

  /** Géométrie arbitraire déjà positionnée (avec collisions gérées par l'appelant). */
  custom(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, mat = 'stone', tint?: number): void {
    this.add(geo, matrix, mat, tint);
  }

  /** Déclare qu'un matériau ne doit pas occulter la peinture anamorphique. */
  setOccluder(mat: string, occluder: boolean): void {
    this.occluderParts.set(mat, occluder);
  }

  /** Fusionne et crée un maillage par matériau. */
  build(materials: Record<string, THREE.Material>, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const mat = materials[key];
      if (!mat) throw new Error(`Matériau inconnu : ${key}`);
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`Fusion impossible : ${key}`);
      for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `arch:${key}`;
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (this.occluderParts.get(key) !== false) mesh.layers.enable(LAYER_OCCLUDER);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}
