import * as THREE from 'three';

// Atmosphère partagée : la même fonction GLSL colore le ciel ET le brouillard
// des objets, si bien que les lointains se fondent exactement dans le ciel.

export const ATMOSPHERE_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec4 uSkyShape;   // x: exposant zénith, y: chute sous l'horizon, z: largeur halo d'horizon, w: intensité halo
uniform vec4 uSunGlow;    // x,y: halo large (intensité, exposant) ; z,w: halo serré
uniform vec4 uFog;        // x: densité, y: décroissance en hauteur, z: altitude de base, w: opacité max
uniform vec3 uFogTint;
uniform float uFogSun;    // diffusion vers le soleil dans le brouillard

vec3 atmosphere(vec3 dir) {
  float y = dir.y;
  float up = max(y, 0.0);
  float t = pow(up, uSkyShape.x);
  vec3 sky = mix(mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.55, t)), uSkyZenith, smoothstep(0.35, 1.0, t));
  vec3 below = mix(uSkyHorizon, uSkyGround, 1.0 - exp(-max(-y, 0.0) * uSkyShape.y));
  vec3 c = mix(below, sky, smoothstep(-0.015, 0.015, y));
  c += uSkyHorizon * uSkyShape.w * exp(-abs(y) * uSkyShape.z);
  float mu = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (uSunGlow.x * pow(mu, uSunGlow.y) + uSunGlow.z * pow(mu, uSunGlow.w));
  return c;
}

vec3 applyAtmosphere(vec3 col, vec3 wpos, vec3 camPos) {
  vec3 rd = wpos - camPos;
  float dist = length(rd);
  rd /= max(dist, 1e-4);
  float a = uFog.x;
  float b = max(uFog.y, 1e-4);
  float roy = camPos.y - uFog.z;
  float k = clamp(b * rd.y * dist, -60.0, 60.0);
  float od = a * exp(clamp(-b * roy, -60.0, 60.0)) * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / (b * rd.y) : dist);
  float f = min(1.0 - exp(-max(od, 0.0)), uFog.w);
  vec3 fogCol = atmosphere(normalize(vec3(rd.x, rd.y * 0.6, rd.z))) * uFogTint;
  float mu = max(dot(rd, uSunDir), 0.0);
  fogCol += uSunColor * uFogSun * pow(mu, 6.0);
  return mix(col, fogCol, f);
}
`;

export interface AtmosphereParams {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  shape: THREE.Vector4;
  sunGlow: THREE.Vector4;
  fog: THREE.Vector4;
  fogTint: THREE.Color;
  fogSun: number;
}

export type AtmosphereUniforms = {
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSkyZenith: THREE.IUniform<THREE.Color>;
  uSkyMid: THREE.IUniform<THREE.Color>;
  uSkyHorizon: THREE.IUniform<THREE.Color>;
  uSkyGround: THREE.IUniform<THREE.Color>;
  uSkyShape: THREE.IUniform<THREE.Vector4>;
  uSunGlow: THREE.IUniform<THREE.Vector4>;
  uFog: THREE.IUniform<THREE.Vector4>;
  uFogTint: THREE.IUniform<THREE.Color>;
  uFogSun: THREE.IUniform<number>;
};

/** Couleurs HDR données en sRGB hexadécimal × intensité. */
export const hdr = (hex: number, intensity = 1): THREE.Color => new THREE.Color(hex).multiplyScalar(intensity);

export class Atmosphere {
  readonly uniforms: AtmosphereUniforms;

  constructor(p: AtmosphereParams) {
    this.uniforms = {
      uSunDir: { value: p.sunDir.clone().normalize() },
      uSunColor: { value: p.sunColor.clone() },
      uSkyZenith: { value: p.zenith.clone() },
      uSkyMid: { value: p.mid.clone() },
      uSkyHorizon: { value: p.horizon.clone() },
      uSkyGround: { value: p.ground.clone() },
      uSkyShape: { value: p.shape.clone() },
      uSunGlow: { value: p.sunGlow.clone() },
      uFog: { value: p.fog.clone() },
      uFogTint: { value: p.fogTint.clone() },
      uFogSun: { value: p.fogSun },
    };
  }

  snapshot(): AtmosphereParams {
    const u = this.uniforms;
    return {
      sunDir: u.uSunDir.value.clone(),
      sunColor: u.uSunColor.value.clone(),
      zenith: u.uSkyZenith.value.clone(),
      mid: u.uSkyMid.value.clone(),
      horizon: u.uSkyHorizon.value.clone(),
      ground: u.uSkyGround.value.clone(),
      shape: u.uSkyShape.value.clone(),
      sunGlow: u.uSunGlow.value.clone(),
      fog: u.uFog.value.clone(),
      fogTint: u.uFogTint.value.clone(),
      fogSun: u.uFogSun.value,
    };
  }

  /** Interpole entre deux états (transitions jour → nuit, etc.). */
  blend(a: AtmosphereParams, b: AtmosphereParams, t: number): void {
    const u = this.uniforms;
    u.uSunDir.value.copy(a.sunDir).lerp(b.sunDir, t).normalize();
    u.uSunColor.value.copy(a.sunColor).lerp(b.sunColor, t);
    u.uSkyZenith.value.copy(a.zenith).lerp(b.zenith, t);
    u.uSkyMid.value.copy(a.mid).lerp(b.mid, t);
    u.uSkyHorizon.value.copy(a.horizon).lerp(b.horizon, t);
    u.uSkyGround.value.copy(a.ground).lerp(b.ground, t);
    u.uSkyShape.value.copy(a.shape).lerp(b.shape, t);
    u.uSunGlow.value.copy(a.sunGlow).lerp(b.sunGlow, t);
    u.uFog.value.copy(a.fog).lerp(b.fog, t);
    u.uFogTint.value.copy(a.fogTint).lerp(b.fogTint, t);
    u.uFogSun.value = a.fogSun + (b.fogSun - a.fogSun) * t;
  }
}
