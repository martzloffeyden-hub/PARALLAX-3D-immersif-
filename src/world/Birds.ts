import * as THREE from 'three';
import { ATMOSPHERE_PARS, type Atmosphere } from '../render/Atmosphere';
import { Rng } from '../util/math';

// Une volée d'oiseaux qui tournoie très haut au-dessus de la place :
// entièrement animée dans le shader (vol circulaire, battements d'ailes).

const VERT = /* glsl */ `
attribute vec4 aOrbit;   // rayon, hauteur, vitesse angulaire, phase
attribute vec2 aFlap;    // fréquence, phase
uniform float uTime;
uniform vec3 uCenter;
varying vec3 vWPos;
void main() {
  float a = aOrbit.w + uTime * aOrbit.z;
  vec3 c = uCenter + vec3(cos(a) * aOrbit.x, aOrbit.y + sin(uTime * 0.21 + aOrbit.w) * 3.0, sin(a) * aOrbit.x);
  // tangente du cercle = direction de vol
  vec3 fwd = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(aOrbit.z));
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 p = position;
  // battement : les extrémités des ailes montent et descendent
  float flap = sin(uTime * aFlap.x + aFlap.y);
  p.y += flap * abs(p.x) * 0.55;
  // inclinaison dans le virage
  vec3 local = right * p.x + up * p.y + fwd * p.z;
  vec3 wp = c + local;
  vWPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
${ATMOSPHERE_PARS}
uniform vec3 uColor;
varying vec3 vWPos;
void main() {
  gl_FragColor = vec4(applyAtmosphere(uColor, vWPos, cameraPosition), 1.0);
}`;

export class Birds {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(atm: Atmosphere, count: number, center: THREE.Vector3, seed = 4) {
    const rng = new Rng(seed);
    // Silhouette : deux ailes en V, envergure ~1,4 m.
    const wing = new Float32Array([
      // aile gauche
      0, 0, 0.25, -0.7, 0.05, -0.1, 0, 0, -0.2,
      // aile droite
      0, 0, 0.25, 0, 0, -0.2, 0.7, 0.05, -0.1,
    ]);
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.BufferAttribute(wing, 3));
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = null;
    geo.setAttribute('position', base.getAttribute('position'));
    const orbit = new Float32Array(count * 4);
    const flap = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const group = i % 3;
      orbit[i * 4] = 60 + group * 25 + rng.range(-8, 8);
      orbit[i * 4 + 1] = 55 + group * 12 + rng.range(-4, 4);
      orbit[i * 4 + 2] = (0.055 + rng.range(-0.008, 0.008)) * (group === 1 ? -1 : 1);
      orbit[i * 4 + 3] = group * 2.1 + rng.range(-0.25, 0.25);
      flap[i * 2] = rng.range(5.5, 8);
      flap[i * 2 + 1] = rng.range(0, 6.28);
    }
    geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(flap, 2));
    geo.instanceCount = count;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...atm.uniforms, uTime: { value: 0 }, uCenter: { value: center.clone() }, uColor: { value: new THREE.Color(0.03, 0.03, 0.035) } },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'birds';
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
