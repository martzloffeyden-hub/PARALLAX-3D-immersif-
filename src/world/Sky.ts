import * as THREE from 'three';
import { ATMOSPHERE_PARS, type Atmosphere } from '../render/Atmosphere';

export interface SkyOptions {
  /** Taille angulaire du disque solaire (cos de l'angle). */
  sunDiskCos?: number;
  sunDiskIntensity?: number;
  /** Couche de nuages d'altitude : couverture 0..1, intensité. */
  clouds?: number;
  cloudColor?: THREE.Color;
  cloudScale?: number;
  stars?: number;
  /** Bande lactée diffuse. */
  galaxy?: number;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 2000.0, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

const FRAG = /* glsl */ `
varying vec3 vDir;
${ATMOSPHERE_PARS}
uniform float uTime;
uniform float uSunDiskCos;
uniform float uSunDisk;
uniform float uClouds;
uniform vec3 uCloudColor;
uniform float uCloudScale;
uniform float uStars;
uniform float uGalaxy;
uniform float uEnvPass;
uniform sampler2D tNoise;

float h13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = atmosphere(dir);
  float mu = dot(dir, uSunDir);

  // Nuages d'altitude : projection sur un plan, bruit en mosaïque.
  if (uClouds > 0.0 && dir.y > 0.0) {
    vec2 p = dir.xz / (dir.y + 0.12) * uCloudScale;
    vec2 wind = vec2(uTime * 0.0035, uTime * 0.0012);
    float n = texture2D(tNoise, p * 0.11 + wind).r * 0.55
            + texture2D(tNoise, p * 0.27 - wind * 1.7).g * 0.3
            + texture2D(tNoise, p * 0.71 + wind * 2.3).r * 0.15;
    float stretch = texture2D(tNoise, p * 0.035 + vec2(0.3, 0.7)).a;
    float th = 0.64 - uClouds * 0.36;
    float d = smoothstep(th, th + 0.22, n * (0.75 + stretch * 0.5));
    d *= smoothstep(0.0, 0.18, dir.y);
    float lit = 0.55 + 0.45 * pow(max(mu, 0.0), 6.0);
    vec3 cc = uCloudColor * lit + uSunColor * 0.05 * pow(max(mu, 0.0), 24.0) * (1.0 - d) * 4.0;
    col = mix(col, cc, d * 0.85);
  }

  // Disque solaire au bord adouci, absent de la capture d'environnement.
  if (uEnvPass < 0.5) {
    float disk = smoothstep(uSunDiskCos - 0.00004, uSunDiskCos + 0.00002, mu);
    col += uSunColor * disk * uSunDisk;
  }

  if (uStars > 0.0 && dir.y > -0.05) {
    vec3 p = dir * 420.0;
    vec3 cell = floor(p);
    float h = h13(cell);
    vec3 off = vec3(h13(cell + 1.7), h13(cell + 3.1), h13(cell + 5.9)) - 0.5;
    vec3 fp = fract(p) - 0.5 - off * 0.6;
    float star = step(0.979, h) * smoothstep(0.11, 0.0, length(fp));
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
    float mag = pow(max(h - 0.979, 0.0) / 0.021, 3.0);
    vec3 sc = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), h13(cell + 9.3));
    float hz = smoothstep(-0.02, 0.25, dir.y);
    col += sc * star * (0.4 + 3.0 * mag) * tw * uStars * hz;
    if (uGalaxy > 0.0) {
      vec3 gAxis = normalize(vec3(0.35, 0.55, -0.76));
      float band = exp(-pow(dot(dir, gAxis) * 3.2, 2.0));
      float gn = texture2D(tNoise, vec2(atan(dir.z, dir.x) * 0.6, dir.y * 1.3) * 0.7).g;
      col += vec3(0.55, 0.6, 0.85) * band * (0.4 + gn * 1.2) * uGalaxy * 0.14 * hz;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(atmosphere: Atmosphere, noise: THREE.Texture, o: SkyOptions = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...atmosphere.uniforms,
        uTime: { value: 0 },
        uSunDiskCos: { value: o.sunDiskCos ?? 0.99985 },
        uSunDisk: { value: o.sunDiskIntensity ?? 40 },
        uClouds: { value: o.clouds ?? 0 },
        uCloudColor: { value: o.cloudColor ?? new THREE.Color(1, 1, 1) },
        uCloudScale: { value: o.cloudScale ?? 1 },
        uStars: { value: o.stars ?? 0 },
        uGalaxy: { value: o.galaxy ?? 0 },
        uEnvPass: { value: 0 },
        tNoise: { value: noise },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    // Dessiné après les opaques : le test de profondeur élimine les pixels masqués.
    this.mesh.renderOrder = 1000;
    this.mesh.name = 'sky';
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
