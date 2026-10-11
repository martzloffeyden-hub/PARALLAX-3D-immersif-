import * as THREE from 'three';
import { ATMOSPHERE_PARS, type Atmosphere } from './Atmosphere';
import type { ProceduralTextureSet } from './ProceduralTextures';

/** Niveau de détail des surfaces (fixé par le profil graphique avant la construction des scènes). */
export const surfaceDetail = { bump: true };

/** Uniformes globaux partagés par tous les matériaux étendus (temps). */
export const globalUniforms = { uTime: { value: 0 } };

/** Calque utilisé pour les objets qui occultent la peinture anamorphique. */
export const LAYER_OCCLUDER = 1;

/**
 * Projecteur de peinture anamorphique (à la Felice Varini) : une figure définie
 * dans le plan image d'un point de vue, peinte sur toutes les surfaces visibles
 * depuis ce point. Une carte de profondeur rendue une fois gère l'occultation.
 */
export class PaintProjector {
  readonly camera: THREE.PerspectiveCamera;
  readonly target: THREE.WebGLRenderTarget;
  readonly uniforms = {
    uPaintMatrix: { value: new THREE.Matrix4() },
    uPaintDepth: { value: null as THREE.Texture | null },
    uPaintOrigin: { value: new THREE.Vector3() },
    uPaintRings: { value: new THREE.Vector4(0.6, 0.05, 0, 0) },
    /** Ligne d'horizon : y, demi-épaisseur, demi-longueur, intervalle central (en NDC). */
    uPaintLine: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPaintColor: { value: new THREE.Color(0xe4472f) },
    uPaintAmount: { value: 1 },
    uPaintGlow: { value: 0 },
    uPaintNF: { value: new THREE.Vector2(1, 100) },
    uPaintSweep: { value: 1 },
  };

  constructor(
    readonly origin: THREE.Vector3,
    readonly lookAt: THREE.Vector3,
    readonly fovDeg: number,
    near: number,
    far: number,
    size: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(fovDeg, 1, near, far);
    this.camera.position.copy(origin);
    this.camera.lookAt(lookAt);
    this.camera.updateMatrixWorld(true);
    this.camera.layers.set(LAYER_OCCLUDER);
    const depthTexture = new THREE.DepthTexture(size, size);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: true,
      depthTexture,
      type: THREE.UnsignedByteType,
      generateMipmaps: false,
    });
    const u = this.uniforms;
    u.uPaintMatrix.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    u.uPaintDepth.value = depthTexture;
    u.uPaintOrigin.value.copy(origin);
    u.uPaintNF.value.set(near, far);
    u.uPaintColor.value.setHex(0xe4472f);
  }

  /** Rayon monde d'un cercle de rayon NDC `r` situé à la distance `dist` du projecteur. */
  worldRadius(rNdc: number, dist: number): number {
    return rNdc * dist * Math.tan(THREE.MathUtils.degToRad(this.fovDeg) / 2);
  }

  renderDepth(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.background = null;
    // Matériau neutre : les surfaces ne doivent pas échantillonner la carte en cours d'écriture.
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    scene.overrideMaterial = depthOnly;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    depthOnly.dispose();
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
  }
}

export interface SurfaceOptions {
  atmosphere: Atmosphere;
  textures?: ProceduralTextureSet;
  /** Répétitions de la texture de pierre par mètre. */
  stoneScale?: number;
  /** Amplitude de la variation d'albédo. */
  variation?: number;
  /** Intensité du relief. */
  bump?: number;
  /** Amplitude de la variation de rugosité. */
  roughVar?: number;
  /** Dallage du sol (taille des dalles, largeur des joints, assombrissement des joints, variation par dalle). */
  slabs?: { sx: number; sz: number; seam: number; seamDark: number; tileVar: number };
  paint?: PaintProjector;
  /** Occlusion de contact près du sol : altitude du sol, hauteur d'effet, intensité. */
  contactAO?: { y: number; height: number; strength: number };
  /** Carte d'occlusion vue du dessus (ombre de contact au sol). */
  topAO?: TopDownAO;
  /** Ombres de nuages qui glissent sur le sol et les murs. */
  cloudShadow?: { noise: THREE.Texture; scale: number; wind: THREE.Vector2; strength: number };
  /** Assises de pierre sur les parois verticales (hauteur d'assise, longueur de bloc). */
  courses?: { h: number; l: number; dark: number };
  /** Coulures et salissures verticales (0..1). */
  weathering?: number;
}

const VERT_DECL = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec2 vStoneUv;
uniform float uStoneScale;
`;

const VERT_BODY = /* glsl */ `
{
  vec4 _wp = vec4(transformed, 1.0);
  vec3 _wn = objectNormal;
  #ifdef USE_INSTANCING
    _wp = instanceMatrix * _wp;
    _wn = mat3(instanceMatrix) * _wn;
  #endif
  _wp = modelMatrix * _wp;
  vWPos = _wp.xyz;
  vWNormal = normalize(mat3(modelMatrix) * _wn);
  vStoneUv = uv * uStoneScale;
}
`;

const FRAG_DECL = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec2 vStoneUv;
${ATMOSPHERE_PARS}
float sHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
#ifdef USE_STONE
uniform sampler2D tStone;
uniform vec3 uStoneParams; // variation, bump, roughVar
vec4 stoneSample;
#endif
#ifdef USE_SLABS
uniform vec4 uSlabs;     // sx, sz, joint, assombrissement
uniform float uSlabVar;
float slabSeam;
float slabRand;
#endif
#ifdef USE_PAINT
uniform mat4 uPaintMatrix;
uniform sampler2D uPaintDepth;
uniform vec3 uPaintOrigin;
uniform vec4 uPaintRings;
uniform vec4 uPaintLine;
uniform vec3 uPaintColor;
uniform float uPaintAmount;
uniform float uPaintGlow;
uniform vec2 uPaintNF;
uniform float uPaintSweep;
float paintMaskValue;
float computePaintMask() {
  vec4 pc = uPaintMatrix * vec4(vWPos, 1.0);
  float w = max(pc.w, 1e-4);
  vec2 ndc = pc.xy / w;
  float r = length(ndc);
  float aa = fwidth(r) * 0.8 + 1e-5;
  float m = smoothstep(uPaintRings.y + aa, uPaintRings.y - aa, abs(r - uPaintRings.x));
  m = max(m, smoothstep(uPaintRings.w + aa, uPaintRings.w - aa, abs(r - uPaintRings.z)));
  // Ligne d'horizon (interrompue au centre, comme l'emblème).
  float ay = fwidth(ndc.y) * 0.8 + 1e-5;
  float ax = fwidth(ndc.x) * 0.8 + 1e-5;
  float line = smoothstep(uPaintLine.y + ay, uPaintLine.y - ay, abs(ndc.y - uPaintLine.x));
  line *= smoothstep(uPaintLine.z + ax, uPaintLine.z - ax, abs(ndc.x));
  line *= smoothstep(uPaintLine.w - ax, uPaintLine.w + ax, abs(ndc.x));
  m = max(m, line);
  float inside = step(0.0, pc.w) * step(abs(ndc.x), 1.0) * step(abs(ndc.y), 1.0);
  float facing = step(0.03, dot(normalize(vWNormal), normalize(uPaintOrigin - vWPos)));
  float d = texture2D(uPaintDepth, clamp(ndc * 0.5 + 0.5, 0.0, 1.0)).r;
  float n = uPaintNF.x;
  float f = uPaintNF.y;
  float zMap = (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
  float vis = step(pc.w, zMap + 0.05 + pc.w * 0.002);
  float ang = fract(atan(ndc.y, ndc.x) / 6.2831853 + 0.25);
  float sweep = smoothstep(ang - 0.002, ang + 0.002, uPaintSweep);
  return m * inside * facing * vis * sweep * uPaintAmount;
}
#endif
#ifdef USE_CONTACT_AO
uniform vec3 uContactAO;
#endif
#ifdef USE_CLOUD_SHADOW
uniform sampler2D tCloudNoise;
uniform vec4 uCloudShadow; // échelle, vent x, vent z, intensité
uniform float uTime;
#endif
#ifdef USE_COURSES
uniform vec3 uCourses;
#endif
#ifdef USE_WEATHER
uniform float uWeather;
#endif
#ifdef USE_TOP_AO
uniform sampler2D uTopAO;
uniform vec4 uTopAOBounds;
uniform float uTopAOGround;
#endif
`;

const FRAG_COLOR = /* glsl */ `
#ifdef USE_STONE
  stoneSample = texture2D(tStone, vStoneUv);
  {
    float macro = texture2D(tStone, vStoneUv * 0.093 + vec2(0.37, 0.61)).b;
    float v = uStoneParams.x;
    diffuseColor.rgb *= mix(1.0 - v, 1.0 + v * 0.45, stoneSample.r) * mix(1.0 - v * 0.6, 1.0 + v * 0.2, macro);
    diffuseColor.rgb *= mix(0.82, 1.0, stoneSample.a);
  }
#endif
#ifdef USE_SLABS
  {
    vec2 sp = vWPos.xz / uSlabs.xy;
    sp.x += 0.5 * step(1.0, mod(floor(sp.y), 2.0));
    vec2 cell = floor(sp);
    vec2 fr = abs(fract(sp) - 0.5);
    vec2 fw = fwidth(sp) + 1e-5;
    vec2 jw = uSlabs.z / uSlabs.xy;
    vec2 e = smoothstep(0.5 - jw - fw, 0.5 - jw + fw * 0.5, fr);
    // joints uniquement sur les faces tournées vers le haut
    slabSeam = max(e.x, e.y) * smoothstep(0.75, 0.95, normalize(vWNormal).y);
    slabRand = sHash12(cell + 17.0);
    diffuseColor.rgb *= (1.0 + (slabRand - 0.5) * uSlabVar) * (1.0 - slabSeam * uSlabs.w);
  }
#endif
#ifdef USE_COURSES
  {
    vec3 wn = normalize(vWNormal);
    float vert = 1.0 - abs(wn.y);
    float along = abs(wn.x) > abs(wn.z) ? vWPos.z : vWPos.x;
    vec2 cp = vec2(along / uCourses.y, vWPos.y / uCourses.x);
    cp.x += 0.5 * step(1.0, mod(floor(cp.y), 2.0));
    vec2 fr = abs(fract(cp) - 0.5);
    vec2 fw = fwidth(cp) + 1e-5;
    vec2 jw = vec2(0.018 / uCourses.y, 0.018 / uCourses.x);
    vec2 e = smoothstep(0.5 - jw - fw, 0.5 - jw + fw * 0.5, fr);
    float joint = max(e.x, e.y) * vert;
    float blockVar = sHash12(floor(cp) + 3.0);
    diffuseColor.rgb *= (1.0 - joint * uCourses.z) * (1.0 + (blockVar - 0.5) * 0.08 * vert);
  }
#endif
#ifdef USE_WEATHER
  {
    float vert = 1.0 - abs(normalize(vWNormal).y);
    // coulures larges et douces (canal basse fréquence), salissure au pied des murs
    float streak = texture2D(tStone, vec2(vStoneUv.x * 0.32, vWPos.y * 0.012 + vStoneUv.x * 0.05)).b;
    float stain = smoothstep(0.45, 0.85, streak) * smoothstep(0.0, 4.0, vWPos.y + 1.0);
    diffuseColor.rgb *= 1.0 - uWeather * vert * (0.075 * stain + 0.07 * smoothstep(0.8, 0.0, vWPos.y));
  }
#endif
#ifdef USE_PAINT
  paintMaskValue = computePaintMask();
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaintColor, paintMaskValue);
#endif
`;

const FRAG_ROUGH = /* glsl */ `
#ifdef USE_STONE
  roughnessFactor = clamp(roughnessFactor + (stoneSample.g - 0.5) * uStoneParams.z, 0.05, 1.0);
#endif
#ifdef USE_SLABS
  roughnessFactor = clamp(roughnessFactor + slabSeam * 0.15 - step(0.85, slabRand) * 0.12, 0.05, 1.0);
#endif
#ifdef USE_PAINT
  roughnessFactor = mix(roughnessFactor, 0.62, paintMaskValue);
#endif
`;

const FRAG_NORMAL = /* glsl */ `
#ifdef USE_STONE_BUMP
  {
    vec2 dSTdx = dFdx(vStoneUv);
    vec2 dSTdy = dFdy(vStoneUv);
    float bs = uStoneParams.y;
    #ifdef USE_PAINT
      bs *= 1.0 - paintMaskValue * 0.6;
    #endif
    float Hll = bs * stoneSample.r;
    float dBx = bs * texture2D(tStone, vStoneUv + dSTdx).r - Hll;
    float dBy = bs * texture2D(tStone, vStoneUv + dSTdy).r - Hll;
    vec3 surfPos = -vViewPosition;
    vec3 vSigmaX = normalize(dFdx(surfPos));
    vec3 vSigmaY = normalize(dFdy(surfPos));
    vec3 R1 = cross(vSigmaY, normal);
    vec3 R2 = cross(normal, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dBx * R1 + dBy * R2);
    normal = normalize(abs(fDet) * normal - vGrad);
  }
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
#ifdef USE_PAINT
  totalEmissiveRadiance += uPaintColor * paintMaskValue * uPaintGlow;
#endif
`;

const FRAG_AO = /* glsl */ `
{
  float _ao = 1.0;
  #ifdef USE_CONTACT_AO
    float h = vWPos.y - uContactAO.x;
    float c = mix(1.0 - uContactAO.z, 1.0, smoothstep(0.0, uContactAO.y, h));
    _ao *= mix(1.0, c, 1.0 - abs(normalize(vWNormal).y) * 0.85);
  #endif
  #ifdef USE_TOP_AO
    vec2 auv = (vWPos.xz - uTopAOBounds.xy) * uTopAOBounds.zw;
    float occ = texture2D(uTopAO, auv).r;
    float inb = step(0.0, auv.x) * step(auv.x, 1.0) * step(0.0, auv.y) * step(auv.y, 1.0);
    _ao *= mix(1.0, occ, inb * smoothstep(1.2, 0.0, vWPos.y - uTopAOGround));
  #endif
  reflectedLight.indirectDiffuse *= _ao;
  reflectedLight.indirectSpecular *= _ao;
  reflectedLight.directDiffuse *= mix(1.0, _ao, 0.35);
  #ifdef USE_CLOUD_SHADOW
    // projection le long de la direction du soleil sur le plan du sol
    vec2 cpos = vWPos.xz - uSunDir.xz / max(uSunDir.y, 0.08) * vWPos.y;
    float cn = texture2D(tCloudNoise, cpos * uCloudShadow.x + uCloudShadow.yz * uTime).r;
    float cshadow = 1.0 - uCloudShadow.w * smoothstep(0.46, 0.66, cn);
    reflectedLight.directDiffuse *= cshadow;
    reflectedLight.directSpecular *= cshadow;
  #endif
}
`;

const FRAG_FOG = /* glsl */ `
gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vWPos, cameraPosition);
`;

/**
 * Étend un MeshStandardMaterial : détail de pierre, dallage, peinture anamorphique,
 * occlusion de contact et atmosphère.
 */
export function extendSurface<T extends THREE.MeshStandardMaterial>(mat: T, o: SurfaceOptions): T {
  const defines: Record<string, string> = {};
  if (o.textures && (o.variation ?? 0.18) > 0) {
    defines.USE_STONE = '';
    if (surfaceDetail.bump && (o.bump ?? 0.012) > 0) defines.USE_STONE_BUMP = '';
  }
  if (o.slabs) defines.USE_SLABS = '';
  if (o.paint) defines.USE_PAINT = '';
  if (o.contactAO) defines.USE_CONTACT_AO = '';
  if (o.topAO) defines.USE_TOP_AO = '';
  if (o.cloudShadow) defines.USE_CLOUD_SHADOW = '';
  if (o.courses) defines.USE_COURSES = '';
  if (o.weathering && o.textures) defines.USE_WEATHER = '';
  const key = 'surf:' + Object.keys(defines).sort().join(',');
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.defines ?? (shader.defines = {}), defines);
    const u = shader.uniforms;
    Object.assign(u, o.atmosphere.uniforms);
    u.uStoneScale = { value: o.stoneScale ?? 1 / 3 };
    if (o.textures) {
      u.tStone = { value: o.textures.stone };
      u.uStoneParams = { value: new THREE.Vector3(o.variation ?? 0.18, o.bump ?? 0.012, o.roughVar ?? 0.25) };
    }
    if (o.slabs) {
      const s = o.slabs;
      u.uSlabs = { value: new THREE.Vector4(s.sx, s.sz, s.seam, s.seamDark) };
      u.uSlabVar = { value: s.tileVar };
    }
    if (o.paint) Object.assign(u, o.paint.uniforms);
    if (o.contactAO) u.uContactAO = { value: new THREE.Vector3(o.contactAO.y, o.contactAO.height, o.contactAO.strength) };
    if (o.topAO) Object.assign(u, o.topAO.uniforms);
    if (o.cloudShadow) {
      const c = o.cloudShadow;
      u.tCloudNoise = { value: c.noise };
      u.uCloudShadow = { value: new THREE.Vector4(c.scale, c.wind.x, c.wind.y, c.strength) };
      u.uTime = globalUniforms.uTime;
    }
    if (o.courses) u.uCourses = { value: new THREE.Vector3(o.courses.h, o.courses.l, o.courses.dark) };
    if (o.weathering) u.uWeather = { value: o.weathering };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO)
      .replace('#include <fog_fragment>', FRAG_FOG);
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * Occlusion vue du dessus : on rend la hauteur de l'architecture depuis le ciel,
 * on la floute, et le sol s'assombrit au pied des volumes (ombre de contact douce).
 */
export class TopDownAO {
  readonly uniforms = {
    uTopAO: { value: null as THREE.Texture | null },
    uTopAOBounds: { value: new THREE.Vector4() },
    uTopAOGround: { value: 0 },
  };
  private target: THREE.WebGLRenderTarget | null = null;
  private blurA: THREE.WebGLRenderTarget | null = null;

  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly width: number,
    readonly depth: number,
    readonly groundY: number,
    readonly resolution = 512,
  ) {
    // La carte est rendue « vue du dessus » : v croît vers -Z.
    this.uniforms.uTopAOBounds.value.set(x0, z0 + depth, 1 / width, -1 / depth);
    this.uniforms.uTopAOGround.value = groundY;
  }

  /** Rend la carte (à appeler une fois, après construction de la scène). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, maxHeight = 30, blurRadiusMeters = 1.4): void {
    const res = this.resolution;
    const aspect = this.depth / this.width;
    const w = res;
    const h = Math.max(16, Math.round(res * aspect));
    const mk = () =>
      new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
    const heightRT = mk();
    this.target = mk();
    this.blurA = mk();
    const cam = new THREE.OrthographicCamera(0, this.width, 0, -this.depth, 0.1, maxHeight + 10);
    // Caméra au-dessus, regardant vers le bas ; x → x, -y écran → +z monde.
    cam.position.set(this.x0, this.groundY + maxHeight + 5, this.z0);
    cam.up.set(0, 0, -1);
    cam.lookAt(this.x0, this.groundY, this.z0);
    cam.left = 0;
    cam.right = this.width;
    cam.top = 0;
    cam.bottom = -this.depth;
    cam.updateProjectionMatrix();
    cam.layers.set(LAYER_OCCLUDER);
    // Matériau qui écrit la hauteur relative au sol.
    const hm = new THREE.ShaderMaterial({
      uniforms: { uGround: { value: this.groundY } },
      vertexShader: `varying float vH; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vH = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uGround; varying float vH; void main(){ gl_FragColor = vec4(max(vH - uGround, 0.0), 0.0, 0.0, 1.0); }`,
      side: THREE.DoubleSide,
    });
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.overrideMaterial = hm;
    scene.background = null;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(heightRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;

    // Flou séparable + conversion hauteur → occlusion.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uFinal: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `
        uniform sampler2D tSrc; uniform vec2 uDir; uniform float uFinal; varying vec2 vUv;
        void main(){
          float s = 0.0; float wsum = 0.0;
          for (int i = -12; i <= 12; i++) {
            float fi = float(i);
            float w = exp(-fi * fi / 50.0);
            float hv = texture2D(tSrc, vUv + uDir * fi).r;
            if (uFinal < 0.5) hv = min(hv, 2.5) / 2.5;
            s += hv * w; wsum += w;
          }
          s /= wsum;
          if (uFinal > 0.5) {
            gl_FragColor = vec4(vec3(1.0 - 0.55 * smoothstep(0.0, 0.75, s)), 1.0);
          } else {
            gl_FragColor = vec4(s, 0.0, 0.0, 1.0);
          }
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(geo, blurMat);
    quad.frustumCulled = false;
    const qs = new THREE.Scene();
    qs.add(quad);
    const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const stepX = blurRadiusMeters / 12 / this.width;
    const stepZ = blurRadiusMeters / 12 / this.depth;
    blurMat.uniforms.tSrc.value = heightRT.texture;
    blurMat.uniforms.uDir.value.set(stepX, 0);
    blurMat.uniforms.uFinal.value = 0;
    renderer.setRenderTarget(this.blurA);
    renderer.render(qs, qc);
    blurMat.uniforms.tSrc.value = this.blurA.texture;
    blurMat.uniforms.uDir.value.set(0, stepZ);
    blurMat.uniforms.uFinal.value = 1;
    renderer.setRenderTarget(this.target);
    renderer.render(qs, qc);
    renderer.setRenderTarget(prev);
    heightRT.dispose();
    this.blurA.dispose();
    this.blurA = null;
    geo.dispose();
    blurMat.dispose();
    hm.dispose();
    this.uniforms.uTopAO.value = this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
  }
}
