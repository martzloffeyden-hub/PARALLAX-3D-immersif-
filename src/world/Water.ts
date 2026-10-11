import * as THREE from 'three';
import { ATMOSPHERE_PARS, type Atmosphere } from '../render/Atmosphere';

// Eau-miroir : réflexion plane rendue à résolution réduite (plan de coupe oblique),
// rides légères, Fresnel, fondu atmosphérique.

const VERT = /* glsl */ `
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${ATMOSPHERE_PARS}
uniform sampler2D tReflect;
uniform sampler2D tNoise;
uniform mat4 uTexMatrix;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uDeep;
uniform float uRipple;
uniform float uHasReflection;
varying vec3 vWPos;
void main() {
  vec4 tc = uTexMatrix * vec4(vWPos, 1.0);
  vec2 suv = tc.xy / tc.w;
  float dist = length(vWPos - cameraPosition);
  vec2 p = vWPos.xz;
  vec2 n = (texture2D(tNoise, p * 0.021 + vec2(uTime * 0.006, uTime * 0.004)).rg - 0.5) * 1.0
         + (texture2D(tNoise, p * 0.067 - vec2(uTime * 0.011, -uTime * 0.007)).gr - 0.5) * 0.5;
  float fade = 1.0 / (1.0 + dist * 0.02);
  vec2 off = n * uRipple * fade;
  vec3 refl = texture2D(tReflect, suv + off).rgb;
  // repli : ciel seul si pas de réflexion
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 R = reflect(-V, normalize(vec3(n.x * 0.15 * fade, 1.0, n.y * 0.15 * fade)));
  vec3 skyRefl = atmosphere(R);
  refl = mix(skyRefl, refl, uHasReflection);
  float cosT = max(V.y, 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 col = mix(uDeep, refl, clamp(0.35 + fres, 0.0, 1.0));
  col = applyAtmosphere(col, vWPos, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}`;

const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q4 = new THREE.Vector4();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Water {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly target: THREE.WebGLRenderTarget;
  readonly mirror = new THREE.PerspectiveCamera();
  scale: number;

  constructor(atm: Atmosphere, noise: THREE.Texture, readonly y: number, hdrType: THREE.TextureDataType, scale: number, deep: THREE.Color) {
    this.scale = scale;
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: hdrType, depthBuffer: true, generateMipmaps: false });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...atm.uniforms,
        tReflect: { value: this.target.texture },
        tNoise: { value: noise },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTexMatrix: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uDeep: { value: deep.clone() },
        uRipple: { value: 0.012 },
        uHasReflection: { value: scale > 0 ? 1 : 0 },
      },
    });
    const geo = new THREE.PlaneGeometry(7000, 7000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = y;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
  }

  /** Rend la réflexion pour `camera` ; `w`,`h` = taille de la cible qui sera dessinée ensuite. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, scene: THREE.Scene, w: number, h: number, time: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    (u.uRes.value as THREE.Vector2).set(w, h);
    this.mesh.position.x = Math.round(camera.position.x / 100) * 100;
    this.mesh.position.z = Math.round(camera.position.z / 100) * 100;
    if (this.scale <= 0) {
      u.uHasReflection.value = 0;
      return;
    }
    u.uHasReflection.value = 1;
    const tw = Math.max(64, Math.round(w * this.scale));
    const th = Math.max(64, Math.round(h * this.scale));
    if (this.target.width !== tw || this.target.height !== th) this.target.setSize(tw, th);
    if (camera.position.y <= this.y + 0.01) return;

    // Caméra miroir.
    const m = this.mirror;
    m.fov = camera.fov;
    m.aspect = camera.aspect;
    m.near = camera.near;
    m.far = camera.far;
    camera.getWorldDirection(_v);
    _t.copy(camera.position).add(_v);
    m.position.set(camera.position.x, 2 * this.y - camera.position.y, camera.position.z);
    _t.y = 2 * this.y - _t.y;
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _up.y = -_up.y;
    m.up.copy(_up);
    m.lookAt(_t);
    m.updateMatrixWorld(true);
    m.updateProjectionMatrix();
    // Plan de coupe oblique : on ne garde que ce qui est au-dessus de l'eau.
    _plane.set(new THREE.Vector3(0, 1, 0), -this.y);
    _plane.applyMatrix4(m.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = m.projectionMatrix;
    _q4.set((Math.sign(_clip.x) + p.elements[8]) / p.elements[0], (Math.sign(_clip.y) + p.elements[9]) / p.elements[5], -1, (1 + p.elements[10]) / p.elements[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q4));
    p.elements[2] = _clip.x;
    p.elements[6] = _clip.y;
    p.elements[10] = _clip.z + 1;
    p.elements[14] = _clip.w;
    m.projectionMatrixInverse.copy(p).invert();
    (u.uTexMatrix.value as THREE.Matrix4)
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(p)
      .multiply(m.matrixWorldInverse);

    this.mesh.visible = false;
    const prev = renderer.getRenderTarget();
    const sm = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, m);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.needsUpdate = sm;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.target.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
