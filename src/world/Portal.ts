import * as THREE from 'three';

// Portail : un disque dans la scène source affiche la scène de destination,
// rendue depuis une caméra virtuelle avec un plan de coupe oblique.
// Traverser le disque permute les scènes sans coupure.

const VERT = /* glsl */ `
varying vec2 vLocal;
varying vec4 vClip;
void main() {
  vLocal = position.xy;
  vClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vClip;
}`;

const FRAG = /* glsl */ `
uniform sampler2D tView;
uniform float uRadius;
uniform float uOpen;
uniform float uTime;
uniform float uExposure;
uniform vec3 uRim;
varying vec2 vLocal;
varying vec4 vClip;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  float r = length(vLocal) / uRadius;
  float open = uOpen;
  // ouverture depuis le centre, bord ondulant
  float ang = atan(vLocal.y, vLocal.x);
  float wob = 0.012 * sin(ang * 7.0 + uTime * 1.3) + 0.008 * sin(ang * 13.0 - uTime * 2.1);
  float edge = open * 1.02 + wob;
  if (r > edge) discard;
  vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
  // léger effet de lentille près du bord
  float lens = smoothstep(edge - 0.25, edge, r);
  vec2 dir = normalize(vLocal + 1e-4);
  suv -= dir * lens * lens * 0.012;
  vec3 col = texture2D(tView, suv).rgb * uExposure;
  float rim = smoothstep(edge - 0.06, edge, r);
  col = mix(col, uRim, rim * 0.85);
  col += uRim * pow(rim, 3.0) * 2.0;
  // voile lumineux pendant l'ouverture
  col = mix(uRim * 1.5, col, smoothstep(0.0, 0.85, open));
  gl_FragColor = vec4(col, 1.0);
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();

export class Portal {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly target: THREE.WebGLRenderTarget;
  readonly vcam = new THREE.PerspectiveCamera();
  /** Repère source : origine au centre du disque, +Z vers le côté d'où l'on vient. */
  readonly source = new THREE.Object3D();
  /** Repère destination (dans la scène de destination). */
  readonly dest = new THREE.Object3D();
  /** Matrice source → destination. */
  readonly transfer = new THREE.Matrix4();
  open = 0;
  enabled = false;
  private prevSide = 1;
  private scale = 0.5;

  constructor(
    readonly radius: number,
    hdrType: THREE.TextureDataType,
  ) {
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: hdrType, depthBuffer: true, generateMipmaps: false });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tView: { value: this.target.texture },
        uRadius: { value: radius },
        uOpen: { value: 0 },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        uRim: { value: new THREE.Color(1.6, 0.55, 0.32) },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.04, 96), this.material);
    this.mesh.name = 'portal';
    this.mesh.visible = false;
  }

  /** Place les deux extrémités. Le disque est orienté selon le repère source. */
  setEnds(srcPos: THREE.Vector3, srcYaw: number, dstPos: THREE.Vector3, dstYaw: number): void {
    this.source.position.copy(srcPos);
    this.source.rotation.set(0, srcYaw, 0);
    this.source.updateMatrixWorld(true);
    this.dest.position.copy(dstPos);
    this.dest.rotation.set(0, dstYaw, 0);
    this.dest.updateMatrixWorld(true);
    this.transfer.copy(this.dest.matrixWorld).multiply(_m.copy(this.source.matrixWorld).invert());
    this.mesh.position.copy(srcPos);
    this.mesh.rotation.set(0, srcYaw, 0);
    this.mesh.updateMatrixWorld(true);
  }

  setResolution(w: number, h: number, scale: number): void {
    this.scale = scale;
    const tw = Math.max(64, Math.round(w * scale));
    const th = Math.max(64, Math.round(h * scale));
    if (this.target.width !== tw || this.target.height !== th) this.target.setSize(tw, th);
  }

  /** Rend la scène de destination vue à travers le portail. */
  render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    destScene: THREE.Scene,
    time: number,
    w: number,
    h: number,
    beforeRender?: (vcam: THREE.PerspectiveCamera, tw: number, th: number) => void,
  ): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uOpen.value = this.open;
    this.mesh.visible = this.enabled && this.open > 0.001;
    if (!this.mesh.visible) return;
    // Visible à l'écran ?
    _v.copy(this.source.position).project(camera);
    const toCam = _v.copy(camera.position).sub(this.source.position);
    const dist = toCam.length();
    if (dist > 400) return;
    this.setResolution(w, h, this.scale);
    // Caméra virtuelle.
    const vc = this.vcam;
    vc.fov = camera.fov;
    vc.aspect = camera.aspect;
    vc.near = camera.near;
    vc.far = camera.far;
    vc.updateProjectionMatrix();
    _m.copy(this.transfer).multiply(camera.matrixWorld);
    _m.decompose(vc.position, _q, _v);
    vc.quaternion.copy(_q);
    vc.updateMatrixWorld(true);
    // Plan de coupe oblique : on ne garde que ce qui est au-delà du disque de destination.
    const n = new THREE.Vector3(0, 0, -1).applyQuaternion(this.dest.quaternion);
    _plane.setFromNormalAndCoplanarPoint(n, this.dest.position);
    _plane.applyMatrix4(vc.matrixWorldInverse);
    // Si la caméra est du mauvais côté, on ne coupe pas (évite d'inverser la projection).
    if (_plane.constant < 0) {
      _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
      const p = vc.projectionMatrix;
      const q = new THREE.Vector4(
        (Math.sign(_clip.x) + p.elements[8]) / p.elements[0],
        (Math.sign(_clip.y) + p.elements[9]) / p.elements[5],
        -1.0,
        (1.0 + p.elements[10]) / p.elements[14],
      );
      const c = _clip.multiplyScalar(2.0 / _clip.dot(q));
      p.elements[2] = c.x;
      p.elements[6] = c.y;
      p.elements[10] = c.z + 1.0;
      p.elements[14] = c.w;
      vc.projectionMatrixInverse.copy(p).invert();
    }
    if (beforeRender) {
      // la scène de destination peut préparer ses propres passes (reflets) pour cette caméra
      const pm = vc.projectionMatrix.clone();
      vc.updateProjectionMatrix();
      beforeRender(vc, this.target.width, this.target.height);
      vc.projectionMatrix.copy(pm);
      vc.projectionMatrixInverse.copy(pm).invert();
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(destScene, vc);
    renderer.setRenderTarget(prev);
  }

  /**
   * Teste la traversée du disque par le point `eye` (monde).
   * Renvoie true au moment où l'on passe du côté +Z au côté -Z à l'intérieur du cercle.
   */
  crossed(eye: THREE.Vector3): boolean {
    const local = this.source.worldToLocal(_v.copy(eye));
    const side = local.z >= 0 ? 1 : -1;
    const inside = Math.hypot(local.x, local.y) < this.radius * this.open * 0.98;
    const crossed = this.enabled && this.open > 0.95 && this.prevSide > 0 && side < 0 && inside && Math.abs(local.z) < 2;
    this.prevSide = side;
    return crossed;
  }

  /** Transfère une pose monde de la source vers la destination. */
  transferPose(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    pos.applyMatrix4(this.transfer);
    _m.extractRotation(this.transfer);
    _q.setFromRotationMatrix(_m);
    quat.premultiply(_q);
  }

  dispose(): void {
    this.target.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
