import * as THREE from 'three';
import { ATMOSPHERE_PARS, type Atmosphere } from '../render/Atmosphere';

// Mer de nuages : une couche épaisse rendue en un seul passage par une courte
// marche de rayon dans un champ de hauteur de bruit (aspect volumétrique, coût maîtrisé).

const VERT = /* glsl */ `
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${ATMOSPHERE_PARS}
uniform sampler2D tNoise;
uniform float uTime;
uniform float uTop;
uniform float uThick;
uniform float uScale;
uniform float uCover;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uDeep;
uniform float uNight;
varying vec3 vWPos;

// Champ de hauteur des nuages (0 = trou, 1 = sommet).
float cloudH(vec2 xz) {
  vec2 w = vec2(uTime * 0.6, uTime * 0.25);
  vec2 p = (xz + w) * uScale;
  float n = texture2D(tNoise, p * 0.11).r * 0.6
          + texture2D(tNoise, p * 0.29 + 0.31).g * 0.28
          + texture2D(tNoise, p * 0.83 - w * 0.0015).r * 0.12;
  float big = texture2D(tNoise, p * 0.027 + 0.7).a;
  n = n * (0.72 + big * 0.56);
  return smoothstep(uCover, uCover + 0.38, n);
}

void main() {
  vec3 rd = normalize(vWPos - cameraPosition);
  float dy = max(0.06, -rd.y);
  // Parallaxe : on descend dans l'épaisseur selon la hauteur locale.
  vec2 xz = vWPos.xz;
  float h = cloudH(xz);
  vec2 shift = rd.xz / dy * uThick;
  xz += shift * (1.0 - h) * 0.55;
  h = cloudH(xz);
  // Normale par différences finies (échelle douce).
  float e = 9.0;
  float hx = cloudH(xz + vec2(e, 0.0));
  float hz = cloudH(xz + vec2(0.0, e));
  vec3 n = normalize(vec3((h - hx) * uThick * 0.35, e * 0.25, (h - hz) * uThick * 0.35));
  vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.12), uSunDir.z));
  float diff = clamp(dot(n, L) * 0.6 + 0.4, 0.0, 1.0);
  float rim = pow(clamp(1.0 - n.y, 0.0, 1.0), 2.0);
  vec3 cloud = mix(uShade, uLit, clamp(diff * 0.8 + h * 0.35 - 0.1, 0.0, 1.0));
  cloud += uLit * rim * 0.35 * pow(max(dot(rd, uSunDir), 0.0), 3.0);
  float cov = smoothstep(0.02, 0.35, h);
  vec3 col = mix(uDeep, cloud, cov);
  col = applyAtmosphere(col, vWPos, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}`;

export class CloudSea {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(atm: Atmosphere, noise: THREE.Texture, o: { top: number; thick: number; steps: number; cover: number; lit: THREE.Color; shade: THREE.Color; deep: THREE.Color; size?: number }) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...atm.uniforms,
        tNoise: { value: noise },
        uTime: { value: 0 },
        uTop: { value: o.top },
        uThick: { value: o.thick },
        uScale: { value: 0.0045 },
        uCover: { value: o.cover },
        uLit: { value: o.lit.clone() },
        uShade: { value: o.shade.clone() },
        uDeep: { value: o.deep.clone() },
        uNight: { value: 0 },
      },
    });
    const size = o.size ?? 6000;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = o.top;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'clouds';
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  update(time: number, camera: THREE.Camera): void {
    this.material.uniforms.uTime.value = time;
    // le plan suit la caméra horizontalement (étendue infinie)
    this.mesh.position.x = Math.round(camera.position.x / 50) * 50;
    this.mesh.position.z = Math.round(camera.position.z / 50) * 50;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
