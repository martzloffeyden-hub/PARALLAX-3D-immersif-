// Collisions simples et robustes : le joueur est un cylindre vertical,
// le monde est fait de boîtes orientées autour de Y et de cylindres.
// Tout est exprimé dans le repère local d'un « référentiel de gravité ».

export type Surface = 'stone' | 'metal' | 'glass' | 'water';

export interface BoxCollider {
  kind: 'box';
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  cos: number;
  sin: number;
  enabled: boolean;
  /** Sol « sûr » : sert de point de réapparition après une chute. */
  safe: boolean;
  surface: Surface;
  tag?: string;
}

export interface CylCollider {
  kind: 'cyl';
  cx: number;
  cz: number;
  r: number;
  yMin: number;
  yMax: number;
  enabled: boolean;
  safe: boolean;
  surface: Surface;
  tag?: string;
}

export interface GroundHit {
  y: number;
  surface: Surface;
  safe: boolean;
}

export interface BoxOptions {
  rotY?: number;
  safe?: boolean;
  surface?: Surface;
  enabled?: boolean;
  tag?: string;
}

export class ColliderSet {
  boxes: BoxCollider[] = [];
  cyls: CylCollider[] = [];
  /** Plan de sol infini optionnel. */
  groundPlane: number | null = null;
  groundSurface: Surface = 'stone';
  /** Limite circulaire douce de la zone jouable (x, z, rayon). */
  bounds: { x: number; z: number; r: number } | null = null;
  /** Limites rectangulaires dures supplémentaires (min/max en x/z). */
  rect: { x0: number; x1: number; z0: number; z1: number } | null = null;

  /** Ajoute une boîte (centre, dimensions complètes). */
  addBox(cx: number, cy: number, cz: number, w: number, h: number, d: number, o: BoxOptions = {}): BoxCollider {
    const a = o.rotY ?? 0;
    const b: BoxCollider = {
      kind: 'box',
      cx,
      cy,
      cz,
      hx: w / 2,
      hy: h / 2,
      hz: d / 2,
      cos: Math.cos(a),
      sin: Math.sin(a),
      enabled: o.enabled ?? true,
      safe: o.safe ?? true,
      surface: o.surface ?? 'stone',
      tag: o.tag,
    };
    this.boxes.push(b);
    return b;
  }

  addCylinder(cx: number, cz: number, r: number, yMin: number, yMax: number, o: BoxOptions = {}): CylCollider {
    const c: CylCollider = {
      kind: 'cyl',
      cx,
      cz,
      r,
      yMin,
      yMax,
      enabled: o.enabled ?? true,
      safe: o.safe ?? true,
      surface: o.surface ?? 'stone',
      tag: o.tag,
    };
    this.cyls.push(c);
    return c;
  }

  setBoxRotation(b: BoxCollider, rotY: number): void {
    b.cos = Math.cos(rotY);
    b.sin = Math.sin(rotY);
  }

  /**
   * Hauteur du sol sous (x, z) : le dessus le plus haut qui ne dépasse pas
   * feetY + stepUp. `margin` élargit la zone d'appui (le joueur peut se tenir au bord).
   */
  groundAt(x: number, z: number, feetY: number, stepUp: number, margin: number): GroundHit | null {
    let best: GroundHit | null = null;
    const limit = feetY + stepUp;
    if (this.groundPlane !== null && this.groundPlane <= limit) {
      best = { y: this.groundPlane, surface: this.groundSurface, safe: true };
    }
    for (const b of this.boxes) {
      if (!b.enabled) continue;
      const top = b.cy + b.hy;
      if (top > limit) continue;
      if (best && top <= best.y) continue;
      const dx = x - b.cx;
      const dz = z - b.cz;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      if (Math.abs(lx) <= b.hx + margin && Math.abs(lz) <= b.hz + margin) {
        best = { y: top, surface: b.surface, safe: b.safe };
      }
    }
    for (const c of this.cyls) {
      if (!c.enabled) continue;
      const top = c.yMax;
      if (top > limit) continue;
      if (best && top <= best.y) continue;
      const dx = x - c.cx;
      const dz = z - c.cz;
      if (dx * dx + dz * dz <= (c.r + margin) * (c.r + margin)) {
        best = { y: top, surface: c.surface, safe: c.safe };
      }
    }
    return best;
  }

  /**
   * Repousse horizontalement le cylindre joueur hors des obstacles.
   * Les obstacles dont le dessus est franchissable (≤ feetY + stepUp) sont ignorés.
   * Retourne la position corrigée (modifie `p`).
   */
  resolve(p: { x: number; z: number }, radius: number, feetY: number, headY: number, stepUp: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.boxes) {
        if (!b.enabled) continue;
        const top = b.cy + b.hy;
        const bottom = b.cy - b.hy;
        if (top <= feetY + stepUp || bottom >= headY) continue;
        const dx = p.x - b.cx;
        const dz = p.z - b.cz;
        // vers le repère local de la boîte
        const lx = dx * b.cos - dz * b.sin;
        const lz = dx * b.sin + dz * b.cos;
        if (Math.abs(lx) > b.hx + radius || Math.abs(lz) > b.hz + radius) continue;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ox = lx - qx;
        let oz = lz - qz;
        const d2 = ox * ox + oz * oz;
        let nlx: number;
        let nlz: number;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          if (d >= radius) continue;
          const push = radius - d;
          ox /= d;
          oz /= d;
          nlx = lx + ox * push;
          nlz = lz + oz * push;
        } else {
          // Centre à l'intérieur : sortie par la face la plus proche.
          const px = b.hx - Math.abs(lx);
          const pz = b.hz - Math.abs(lz);
          if (px < pz) {
            nlx = Math.sign(lx || 1) * (b.hx + radius);
            nlz = lz;
          } else {
            nlx = lx;
            nlz = Math.sign(lz || 1) * (b.hz + radius);
          }
        }
        // retour au repère du référentiel
        p.x = b.cx + nlx * b.cos + nlz * b.sin;
        p.z = b.cz - nlx * b.sin + nlz * b.cos;
        moved = true;
        hit = true;
      }
      for (const c of this.cyls) {
        if (!c.enabled) continue;
        if (c.yMax <= feetY + stepUp || c.yMin >= headY) continue;
        const dx = p.x - c.cx;
        const dz = p.z - c.cz;
        const rr = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-5;
        p.x = c.cx + (dx / d) * rr;
        p.z = c.cz + (dz / d) * rr;
        moved = true;
        hit = true;
      }
      if (!moved) break;
    }
    if (this.rect) {
      const r = this.rect;
      p.x = Math.min(r.x1 - radius, Math.max(r.x0 + radius, p.x));
      p.z = Math.min(r.z1 - radius, Math.max(r.z0 + radius, p.z));
    }
    return hit;
  }
}
