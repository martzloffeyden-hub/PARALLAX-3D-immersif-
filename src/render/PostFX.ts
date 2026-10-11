import * as THREE from 'three';

// Pipeline de post-traitement HDR compact, pensé pour les GPU intégrés :
//   scène (RGBA16F, MSAA optionnel) → bloom (chaîne de mips double filtre)
//   → composite unique (exposition, AgX, étalonnage, vignettage, aberration, grain)
//   → FXAA optionnel.

const FS_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const HEADER = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
`;

const DOWNSAMPLE_FRAG = HEADER + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
uniform float uKnee;

vec3 S(vec2 o) { return texture(tSrc, vUv + uTexel * o).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
  float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b));
  float wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
  return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}

void main() {
  vec3 a = S(vec2(-2.0, 2.0)), b = S(vec2(0.0, 2.0)), c = S(vec2(2.0, 2.0));
  vec3 d = S(vec2(-2.0, 0.0)), e = S(vec2(0.0, 0.0)), f = S(vec2(2.0, 0.0));
  vec3 g = S(vec2(-2.0, -2.0)), h = S(vec2(0.0, -2.0)), i = S(vec2(2.0, -2.0));
  vec3 j = S(vec2(-1.0, 1.0)), k = S(vec2(1.0, 1.0)), l = S(vec2(-1.0, -1.0)), m = S(vec2(1.0, -1.0));
  vec3 col;
  if (uFirst > 0.5) {
    // Moyenne de Karis : supprime les « lucioles » sur la première réduction.
    col = karis(j, k, l, m) * 0.5
        + karis(a, b, d, e) * 0.125 + karis(b, c, e, f) * 0.125
        + karis(d, e, g, h) * 0.125 + karis(e, f, h, i) * 0.125;
    // Seuil doux (courbe quadratique autour du genou).
    float br = max(col.r, max(col.g, col.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = (rq * rq) / (4.0 * uKnee + 1e-4);
    float w = max(rq, br - uThreshold) / max(br, 1e-4);
    col *= w;
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const UPSAMPLE_FRAG = HEADER + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
vec3 S(vec2 o) { return texture(tSrc, vUv + uTexel * o).rgb; }
void main() {
  vec3 col = S(vec2(0.0)) * 4.0
    + (S(vec2(-1.0, 0.0)) + S(vec2(1.0, 0.0)) + S(vec2(0.0, -1.0)) + S(vec2(0.0, 1.0))) * 2.0
    + S(vec2(-1.0, -1.0)) + S(vec2(1.0, -1.0)) + S(vec2(-1.0, 1.0)) + S(vec2(1.0, 1.0));
  fragColor = vec4(col / 16.0 * uWeight, 1.0);
}`;

const COMMON_GRADE = /* glsl */ `
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
// AgX (Blender / Filament) avec un « look » réglable (pente, puissance, saturation).
vec3 agx(vec3 color, float lookPower, float lookSat) {
  const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  color = inset * (toRec2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  // look
  color = pow(max(color, 0.0), vec3(lookPower));
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = l + lookSat * (color - l);
  color = outset * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = fromRec2020 * color;
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 applyGrain(vec3 col, vec2 fragCoord, float amount, float time) {
  float n = hash12(fragCoord + fract(time * 7.13) * 413.0) + hash12(fragCoord * 1.37 + fract(time * 3.71) * 97.0) - 1.0;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  // Le grain est plus visible dans les tons moyens, comme sur la pellicule.
  float w = amount * (0.35 + 0.65 * (1.0 - abs(lum * 2.0 - 1.0)));
  col += n * w;
  // tramage anti-bandes
  col += (hash12(fragCoord * 0.731 + 11.0) - 0.5) / 255.0;
  return col;
}
`;

const COMPOSITE_FRAG = HEADER + COMMON_GRADE + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uCA;
uniform float uGrain;
uniform float uLookPower;
uniform float uLookSat;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform vec3 uFadeColor;
uniform float uFade;
uniform float uFocus;
uniform vec2 uFocusCenter;

void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  float aspect = uResolution.x / uResolution.y;
  vec3 col;
  if (uCA > 0.0) {
    vec2 off = dc * dot(dc, dc) * uCA * 0.012;
    col = vec3(texture(tScene, uv - off).r, texture(tScene, uv).g, texture(tScene, uv + off).b);
  } else {
    col = texture(tScene, uv).rgb;
  }
  col += texture(tBloom, uv).rgb * uBloomStrength;
  col += uFlashColor * uFlash;

  // Vignettage optique (avant tone mapping) + vignettage « observation ».
  vec2 dv = dc * vec2(aspect, 1.0);
  float r = length(dv);
  col *= mix(1.0, smoothstep(1.05, 0.25, r), uVignette);
  vec2 df = (uv - uFocusCenter) * vec2(aspect, 1.0);
  float focusMask = smoothstep(0.18, 0.85, length(df));
  col *= 1.0 - uFocus * 0.55 * focusMask;

  col *= uExposure;
  col = agx(col, uLookPower, uLookSat);

  // Désaturation de la périphérie en mode observation.
  float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum0), uFocus * 0.6 * focusMask);

  col = linearToSRGB(col);
  // Étalonnage lift / gamma / gain dans l'espace d'affichage.
  col = uGain * (col + uLift * (1.0 - col));
  col = pow(max(col, 0.0), 1.0 / uGamma);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;

  col = mix(col, uFadeColor, uFade);
  if (uGrain > 0.0) col = applyGrain(col, gl_FragCoord.xy, uGrain, uTime);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FXAA_FRAG = HEADER + COMMON_GRADE + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uResolution;
uniform float uGrain;
uniform float uTime;
void main() {
  vec2 inv = 1.0 / uResolution;
  vec2 fc = gl_FragCoord.xy;
  vec3 rgbNW = texture(tSrc, (fc + vec2(-1.0, -1.0)) * inv).rgb;
  vec3 rgbNE = texture(tSrc, (fc + vec2(1.0, -1.0)) * inv).rgb;
  vec3 rgbSW = texture(tSrc, (fc + vec2(-1.0, 1.0)) * inv).rgb;
  vec3 rgbSE = texture(tSrc, (fc + vec2(1.0, 1.0)) * inv).rgb;
  vec3 rgbM = texture(tSrc, fc * inv).rgb;
  vec3 L = vec3(0.299, 0.587, 0.114);
  float lNW = dot(rgbNW, L), lNE = dot(rgbNE, L), lSW = dot(rgbSW, L), lSE = dot(rgbSE, L), lM = dot(rgbM, L);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * inv;
  vec2 uv = fc * inv;
  vec3 rgbA = 0.5 * (texture(tSrc, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tSrc, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(tSrc, uv - dir * 0.5).rgb + texture(tSrc, uv + dir * 0.5).rgb);
  float lB = dot(rgbB, L);
  vec3 col = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  if (uGrain > 0.0) col = applyGrain(col, gl_FragCoord.xy, uGrain, uTime);
  fragColor = vec4(col, 1.0);
}`;

export interface GradeParams {
  exposure: number;
  bloomStrength: number;
  bloomThreshold: number;
  bloomKnee: number;
  vignette: number;
  grain: number;
  ca: number;
  lookPower: number;
  lookSat: number;
  lift: THREE.Color;
  gamma: THREE.Color;
  gain: THREE.Color;
  saturation: number;
  contrast: number;
}

export function defaultGrade(): GradeParams {
  return {
    exposure: 1,
    bloomStrength: 0.06,
    bloomThreshold: 1.2,
    bloomKnee: 0.6,
    vignette: 0.35,
    grain: 0.024,
    ca: 0.6,
    lookPower: 1.12,
    lookSat: 1.15,
    lift: new THREE.Color(0, 0, 0),
    gamma: new THREE.Color(1, 1, 1),
    gain: new THREE.Color(1, 1, 1),
    saturation: 1,
    contrast: 1,
  };
}

/** Copie/interpole deux réglages d'étalonnage. */
export function lerpGrade(out: GradeParams, a: GradeParams, b: GradeParams, t: number): GradeParams {
  const L = (x: number, y: number) => x + (y - x) * t;
  out.exposure = L(a.exposure, b.exposure);
  out.bloomStrength = L(a.bloomStrength, b.bloomStrength);
  out.bloomThreshold = L(a.bloomThreshold, b.bloomThreshold);
  out.bloomKnee = L(a.bloomKnee, b.bloomKnee);
  out.vignette = L(a.vignette, b.vignette);
  out.grain = L(a.grain, b.grain);
  out.ca = L(a.ca, b.ca);
  out.lookPower = L(a.lookPower, b.lookPower);
  out.lookSat = L(a.lookSat, b.lookSat);
  out.lift.copy(a.lift).lerp(b.lift, t);
  out.gamma.copy(a.gamma).lerp(b.gamma, t);
  out.gain.copy(a.gain).lerp(b.gain, t);
  out.saturation = L(a.saturation, b.saturation);
  out.contrast = L(a.contrast, b.contrast);
  return out;
}

export class FullscreenPass {
  readonly material: THREE.RawShaderMaterial;
  constructor(frag: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
  }
  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }
}

export class PostFX {
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private ldrTarget: THREE.WebGLRenderTarget;
  private mips: THREE.WebGLRenderTarget[] = [];
  private readonly geo: THREE.BufferGeometry;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly down: FullscreenPass;
  private readonly up: FullscreenPass;
  readonly composite: FullscreenPass;
  private readonly fxaa: FullscreenPass;
  private width = 1;
  private height = 1;
  private bloomLevels = 5;
  fxaaEnabled = true;
  caEnabled = true;
  readonly grade: GradeParams = defaultGrade();
  /** Effets transitoires pilotés par le jeu. */
  flash = 0;
  readonly flashColor = new THREE.Color(1, 0.9, 0.8);
  fade = 1;
  readonly fadeColor = new THREE.Color(0, 0, 0);
  focus = 0;
  readonly focusCenter = new THREE.Vector2(0.5, 0.5);

  constructor(private renderer: THREE.WebGLRenderer, msaa: number, hdrType: THREE.TextureDataType) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(this.geo);
    this.quad.frustumCulled = false;

    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: hdrType,
      format: THREE.RGBAFormat,
      samples: msaa,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.ldrTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: false,
    });

    this.down = new FullscreenPass(
      DOWNSAMPLE_FRAG,
      {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uFirst: { value: 0 },
        uThreshold: { value: 1 },
        uKnee: { value: 0.5 },
      },
    );
    this.up = new FullscreenPass(
      UPSAMPLE_FRAG,
      { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
    );
    this.up.material.blending = THREE.CustomBlending;
    this.up.material.blendSrc = THREE.OneFactor;
    this.up.material.blendDst = THREE.OneFactor;
    this.up.material.blendEquation = THREE.AddEquation;
    this.up.material.transparent = true;

    this.composite = new FullscreenPass(
      COMPOSITE_FRAG,
      {
        tScene: { value: this.sceneTarget.texture },
        tBloom: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        uBloomStrength: { value: 0.05 },
        uVignette: { value: 0.3 },
        uCA: { value: 0 },
        uGrain: { value: 0.03 },
        uLookPower: { value: 1.1 },
        uLookSat: { value: 1.1 },
        uLift: { value: new THREE.Color(0, 0, 0) },
        uGamma: { value: new THREE.Color(1, 1, 1) },
        uGain: { value: new THREE.Color(1, 1, 1) },
        uSaturation: { value: 1 },
        uContrast: { value: 1 },
        uFlashColor: { value: this.flashColor },
        uFlash: { value: 0 },
        uFadeColor: { value: this.fadeColor },
        uFade: { value: 1 },
        uFocus: { value: 0 },
        uFocusCenter: { value: this.focusCenter },
      },
    );
    this.fxaa = new FullscreenPass(
      FXAA_FRAG,
      {
        tSrc: { value: this.ldrTarget.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uGrain: { value: 0 },
        uTime: { value: 0 },
      },
    );
    this.scene.add(this.quad);
  }

  setMSAA(samples: number): void {
    if (this.sceneTarget.samples === samples) return;
    this.sceneTarget.samples = samples;
    // Force la réallocation du tampon multi-échantillonné.
    this.sceneTarget.dispose();
  }

  setBloomLevels(n: number): void {
    if (n === this.bloomLevels) return;
    this.bloomLevels = n;
    this.allocateMips();
  }

  setSize(w: number, h: number): void {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height && this.mips.length) return;
    this.width = w;
    this.height = h;
    this.sceneTarget.setSize(w, h);
    this.ldrTarget.setSize(w, h);
    this.allocateMips();
    (this.composite.uniforms.uResolution.value as THREE.Vector2).set(w, h);
    (this.fxaa.uniforms.uResolution.value as THREE.Vector2).set(w, h);
  }

  private allocateMips(): void {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let w = this.width;
    let h = this.height;
    for (let i = 0; i < this.bloomLevels; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.mips.push(
        new THREE.WebGLRenderTarget(w, h, {
          type: this.sceneTarget.texture.type,
          depthBuffer: false,
          generateMipmaps: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        }),
      );
    }
  }

  private draw(pass: FullscreenPass, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = pass.material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  /** Exécute le post-traitement à partir de `sceneTarget` (déjà rendu). */
  render(time: number): void {
    const r = this.renderer;
    const g = this.grade;
    // --- Bloom : réduction
    let src: THREE.Texture = this.sceneTarget.texture;
    let sw = this.width;
    let sh = this.height;
    const du = this.down.uniforms;
    du.uThreshold.value = g.bloomThreshold;
    du.uKnee.value = Math.max(0.01, g.bloomKnee);
    for (let i = 0; i < this.mips.length; i++) {
      du.tSrc.value = src;
      (du.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
      du.uFirst.value = i === 0 ? 1 : 0;
      this.draw(this.down, this.mips[i]);
      src = this.mips[i].texture;
      sw = this.mips[i].width;
      sh = this.mips[i].height;
    }
    // --- Bloom : remontée additive
    const uu = this.up.uniforms;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const s = this.mips[i];
      uu.tSrc.value = s.texture;
      (uu.uTexel.value as THREE.Vector2).set(1 / s.width, 1 / s.height);
      uu.uWeight.value = 1;
      this.draw(this.up, this.mips[i - 1]);
    }
    // --- Composite
    const cu = this.composite.uniforms;
    cu.tScene.value = this.sceneTarget.texture;
    cu.tBloom.value = this.mips[0].texture;
    cu.uTime.value = time;
    cu.uExposure.value = g.exposure;
    cu.uBloomStrength.value = g.bloomStrength / Math.max(1, this.mips.length * 0.5);
    cu.uVignette.value = g.vignette;
    cu.uCA.value = this.caEnabled ? g.ca : 0;
    cu.uLookPower.value = g.lookPower;
    cu.uLookSat.value = g.lookSat;
    (cu.uLift.value as THREE.Color).copy(g.lift);
    (cu.uGamma.value as THREE.Color).copy(g.gamma);
    (cu.uGain.value as THREE.Color).copy(g.gain);
    cu.uSaturation.value = g.saturation;
    cu.uContrast.value = g.contrast;
    cu.uFlash.value = this.flash;
    cu.uFade.value = this.fade;
    cu.uFocus.value = this.focus;
    if (this.fxaaEnabled) {
      cu.uGrain.value = 0;
      this.draw(this.composite, this.ldrTarget);
      const fu = this.fxaa.uniforms;
      fu.uGrain.value = g.grain;
      fu.uTime.value = time;
      this.draw(this.fxaa, null);
    } else {
      cu.uGrain.value = g.grain;
      this.draw(this.composite, null);
    }
    r.setRenderTarget(null);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.ldrTarget.dispose();
    for (const m of this.mips) m.dispose();
    this.geo.dispose();
    this.down.material.dispose();
    this.up.material.dispose();
    this.composite.material.dispose();
    this.fxaa.material.dispose();
  }
}
