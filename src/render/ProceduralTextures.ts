import * as THREE from 'three';

// Textures générées sur le GPU au chargement : aucune image externe.
// Toutes sont périodiques (raccord parfait en mosaïque).

const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const NOISE_LIB = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// Bruit de gradient périodique (période entière par axe).
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 i00 = mod(i, per), i10 = mod(i + vec2(1.0, 0.0), per);
  vec2 i01 = mod(i + vec2(0.0, 1.0), per), i11 = mod(i + vec2(1.0, 1.0), per);
  float a = dot(hash22(i00) * 2.0 - 1.0, f);
  float b = dot(hash22(i10) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(i01) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(i11) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}
float pfbm(vec2 uv, float baseFreq, int oct, float gain) {
  float s = 0.0, amp = 0.5, norm = 0.0;
  float f = baseFreq;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += amp * pnoise(uv * f, vec2(f));
    norm += amp;
    amp *= gain;
    f *= 2.0;
  }
  return s / norm;
}
// Cellulaire périodique (distance au point le plus proche).
float pworley(vec2 uv, float freq) {
  vec2 p = uv * freq;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float md = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 h = hash22(mod(i + o, vec2(freq)));
    vec2 r = o + h - f;
    md = min(md, dot(r, r));
  }
  return sqrt(md);
}
`;

const STONE_FRAG = NOISE_LIB + /* glsl */ `
void main() {
  vec2 uv = vUv;
  // Ondulation légère du domaine pour éviter un aspect trop « numérique ».
  vec2 w = vec2(pfbm(uv + 0.31, 4.0, 3, 0.5), pfbm(uv + 0.77, 4.0, 3, 0.5)) * 0.04;
  float h = pfbm(uv + w, 8.0, 6, 0.52) * 0.5 + 0.5;
  float fine = pfbm(uv, 64.0, 3, 0.5) * 0.5 + 0.5;
  h = h * 0.8 + fine * 0.2;
  float rough = pfbm(uv + 0.5, 6.0, 5, 0.55) * 0.5 + 0.5;
  float blot = smoothstep(0.2, 0.8, pfbm(uv + 0.13, 2.0, 4, 0.5) * 0.5 + 0.5);
  float pits = smoothstep(0.0, 0.12, pworley(uv, 48.0));
  float pits2 = smoothstep(0.0, 0.08, pworley(uv + 0.37, 96.0));
  fragColor = vec4(h, rough, blot, min(pits, pits2));
}`;

const NOISE_FRAG = NOISE_LIB + /* glsl */ `
void main() {
  vec2 uv = vUv;
  float a = pfbm(uv, 4.0, 6, 0.5) * 0.5 + 0.5;
  float b = pfbm(uv + 0.37, 8.0, 5, 0.55) * 0.5 + 0.5;
  float c = 1.0 - pworley(uv, 8.0);
  float d = pfbm(uv + 0.71, 2.0, 4, 0.5) * 0.5 + 0.5;
  fragColor = vec4(a, b, c, d);
}`;

function generate(renderer: THREE.WebGLRenderer, frag: string, size: number): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  });
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  mat.dispose();
  geo.dispose();
  rt.texture.name = 'procedural';
  // La cible de rendu reste vivante : sa texture est utilisée directement.
  return rt.texture;
}

export interface ProceduralTextureSet {
  stone: THREE.Texture;
  noise: THREE.Texture;
}

export function createProceduralTextures(renderer: THREE.WebGLRenderer): ProceduralTextureSet {
  return {
    stone: generate(renderer, STONE_FRAG, 1024),
    noise: generate(renderer, NOISE_FRAG, 256),
  };
}
