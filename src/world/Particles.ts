import * as THREE from 'three';
import { ATMOSPHERE_PARS, type Atmosphere } from '../render/Atmosphere';
import { Rng } from '../util/math';

// Deux systèmes de particules légers (un seul appel de dessin chacun) :
// - Motes : poussières en suspension autour du joueur, qui scintillent à contre-jour.
// - DustBursts : bouffées de poussière lors des mouvements de pierre.

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform float uBox;
uniform float uSize;
uniform float uPixel;
attribute vec4 seed;
varying float vAlpha;
varying vec3 vWPos;
void main() {
  // position enroulée dans une boîte qui suit la caméra (densité constante)
  vec3 p = position + vec3(sin(uTime * 0.11 + seed.x * 6.28), cos(uTime * 0.07 + seed.y * 6.28) * 0.6, sin(uTime * 0.09 + seed.z * 6.28)) * 1.5;
  p += vec3(uTime * 0.18, uTime * 0.03, uTime * 0.05) * (0.4 + seed.w);
  vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCenter + rel;
  vWPos = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(uSize * uPixel * (0.5 + seed.w) / max(d, 0.1), 1.0, 9.0);
  float edge = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(rel));
  vAlpha = edge * smoothstep(0.3, 1.5, d);
}`;

const MOTE_FRAG = /* glsl */ `
${ATMOSPHERE_PARS}
uniform float uIntensity;
varying float vAlpha;
varying vec3 vWPos;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  vec3 V = normalize(vWPos - cameraPosition);
  float mu = max(dot(V, uSunDir), 0.0);
  float scatter = 0.15 + 2.5 * pow(mu, 8.0);
  vec3 col = uSunColor * scatter * uIntensity;
  gl_FragColor = vec4(col * a * vAlpha, 0.0);
}`;

export class Motes {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  constructor(atm: Atmosphere, count: number, box = 26, intensity = 0.25, size = 0.05) {
    const rng = new Rng(99);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rng.range(-box, box);
      pos[i * 3 + 1] = rng.range(-box, box);
      pos[i * 3 + 2] = rng.range(-box, box);
      seed[i * 4] = rng.next();
      seed[i * 4 + 1] = rng.next();
      seed[i * 4 + 2] = rng.next();
      seed[i * 4 + 3] = rng.next();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.material = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: {
        ...atm.uniforms,
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: box },
        uSize: { value: size },
        uPixel: { value: 900 },
        uIntensity: { value: intensity },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  update(time: number, camera: THREE.Camera, pixelHeight: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector3).copy(camera.position);
    u.uPixel.value = pixelHeight;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

const DUST_VERT = /* glsl */ `
attribute vec4 life;   // x: naissance, y: durée, z: taille, w: graine
attribute vec3 vel;
uniform float uTime;
uniform float uPixel;
varying float vA;
varying vec3 vWPos;
void main() {
  float age = uTime - life.x;
  float k = clamp(age / life.y, 0.0, 1.0);
  vec3 p = position + vel * (1.0 - exp(-age * 1.6)) / 1.6 + vec3(0.0, age * 0.25, 0.0);
  vWPos = p;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = life.z * (0.4 + k * 1.6);
  gl_PointSize = clamp(size * uPixel / max(-mv.z, 0.1), 0.0, 220.0);
  vA = (age < 0.0 || k >= 1.0) ? 0.0 : smoothstep(0.0, 0.08, k) * (1.0 - k) * (1.0 - k);
}`;

const DUST_FRAG = /* glsl */ `
${ATMOSPHERE_PARS}
uniform vec3 uColor;
varying float vA;
varying vec3 vWPos;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.05, d) * vA * 0.55;
  if (a < 0.003) discard;
  vec3 V = normalize(vWPos - cameraPosition);
  float mu = max(dot(V, uSunDir), 0.0);
  vec3 col = uColor * (0.55 + 0.45 * mu) + uSunColor * 0.08 * pow(mu, 4.0);
  col = applyAtmosphere(col, vWPos, cameraPosition);
  gl_FragColor = vec4(col, a);
}`;

export class DustBursts {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private readonly n: number;
  private readonly rng = new Rng(5);
  time = 0;

  constructor(atm: Atmosphere, count = 700, color = new THREE.Color(0.75, 0.66, 0.55)) {
    this.n = count;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('vel', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const life = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) life[i * 4] = -1e6;
    geo.setAttribute('life', new THREE.BufferAttribute(life, 4));
    this.material = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { ...atm.uniforms, uTime: { value: 0 }, uPixel: { value: 900 }, uColor: { value: color } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  /** Émet une bouffée sur un segment horizontal (base d'un mur) ou autour d'un point. */
  burst(center: THREE.Vector3, spread: THREE.Vector3, count: number, speed = 1.5, size = 1.4, dur = 3.5): void {
    const geo = this.points.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const vel = geo.attributes.vel as THREE.BufferAttribute;
    const life = geo.attributes.life as THREE.BufferAttribute;
    const r = this.rng;
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      pos.setXYZ(i, center.x + r.range(-1, 1) * spread.x, center.y + r.range(0, 1) * spread.y, center.z + r.range(-1, 1) * spread.z);
      const a = r.range(0, Math.PI * 2);
      const s = speed * r.range(0.3, 1);
      vel.setXYZ(i, Math.cos(a) * s, r.range(0.1, 0.8) * speed, Math.sin(a) * s);
      life.setXYZW(i, this.time + r.range(0, 0.25), dur * r.range(0.6, 1.2), size * r.range(0.5, 1.4), r.next());
    }
    pos.needsUpdate = true;
    vel.needsUpdate = true;
    life.needsUpdate = true;
  }

  update(dt: number, pixelHeight: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uPixel.value = pixelHeight;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
