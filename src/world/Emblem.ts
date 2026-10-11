import * as THREE from 'three';
import { ATMOSPHERE_PARS, type Atmosphere } from '../render/Atmosphere';

// L'emblème matérialisé : anneau, anneau intérieur et ligne d'horizon,
// en lumière vermillon. Révélation angulaire synchronisée avec l'effacement
// de la peinture (même convention d'angle que le projecteur).

const VERT = /* glsl */ `
uniform float uSpin;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vWPos;
void main() {
  vLocal = (vec4(position, 1.0)).xyz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${ATMOSPHERE_PARS}
uniform float uReveal;
uniform vec3 uColor;
uniform float uGlow;
uniform float uOpacity;
uniform float uTime;
uniform float uRefAngle;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vWPos;
void main() {
  float ang = fract(atan(vLocal.y, vLocal.x) / 6.2831853 + 0.25 + uRefAngle);
  if (ang < uReveal) discard;
  vec3 V = normalize(cameraPosition - vWPos);
  float ndv = abs(dot(normalize(vN), V));
  // cœur blanc-chaud au centre du tube, vermillon sur les bords
  vec3 core = mix(uColor, vec3(1.0, 0.7, 0.5), pow(ndv, 4.0) * 0.45);
  float pulse = 1.0 + 0.06 * sin(uTime * 2.3 + ang * 18.0);
  vec3 col = core * uGlow * pulse * (0.55 + 0.45 * ndv);
  // front de révélation lumineux
  col += vec3(1.0, 0.8, 0.6) * smoothstep(0.03, 0.0, ang - uReveal) * uGlow * 1.5 * step(0.001, uReveal);
  col = applyAtmosphere(col, vWPos, cameraPosition);
  gl_FragColor = vec4(col, uOpacity);
}`;

export class Emblem {
  readonly group = new THREE.Group();
  readonly ring: THREE.Mesh;
  readonly inner: THREE.Mesh;
  readonly bar: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly innerMat: THREE.ShaderMaterial;
  readonly barMat: THREE.ShaderMaterial;

  constructor(
    atm: Atmosphere,
    readonly radius: number,
    tube: number,
    innerRadius: number,
    innerTube: number,
    barHalf: number,
    barTube: number,
  ) {
    const mk = () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          ...atm.uniforms,
          uReveal: { value: 1 },
          uColor: { value: new THREE.Color(1.0, 0.2, 0.09) },
          uGlow: { value: 2.0 },
          uOpacity: { value: 1 },
          uTime: { value: 0 },
          uRefAngle: { value: 0 },
          uSpin: { value: 0 },
        },
        transparent: false,
      });
    this.material = mk();
    this.innerMat = mk();
    this.barMat = mk();
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 20, 200), this.material);
    this.inner = new THREE.Mesh(new THREE.TorusGeometry(innerRadius, innerTube, 10, 160), this.innerMat);
    const barGeo = new THREE.CylinderGeometry(barTube, barTube, barHalf * 2, 10, 24);
    barGeo.rotateZ(Math.PI / 2);
    this.bar = new THREE.Mesh(barGeo, this.barMat);
    this.group.add(this.ring, this.inner, this.bar);
    this.group.name = 'emblem';
  }

  set reveal(v: number) {
    this.material.uniforms.uReveal.value = v;
    this.innerMat.uniforms.uReveal.value = v;
    this.barMat.uniforms.uReveal.value = v;
  }

  set glow(v: number) {
    this.material.uniforms.uGlow.value = v;
    this.innerMat.uniforms.uGlow.value = v;
    this.barMat.uniforms.uGlow.value = v;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
    this.innerMat.uniforms.uTime.value = time;
    this.barMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    for (const m of [this.ring, this.inner, this.bar]) m.geometry.dispose();
    this.material.dispose();
    this.innerMat.dispose();
    this.barMat.dispose();
  }
}
