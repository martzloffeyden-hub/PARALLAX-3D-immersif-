import type { QualityProfile } from '../app/Settings';

/** Paramètres de rendu dérivés du profil graphique. */
export interface QualityPreset {
  msaa: number;
  fxaa: boolean;
  shadowMapSize: number;
  shadowRadius: number;
  bloomLevels: number;
  /** Fraction de la résolution pour les reflets de l'eau (0 = désactivé). */
  reflectionScale: number;
  /** Fraction de la résolution pour le rendu des portails. */
  portalScale: number;
  /** Multiplicateur du nombre de particules / éclats. */
  particleDensity: number;
  /** Plage de la résolution adaptative. */
  minScale: number;
  maxScale: number;
  cloudLayers: number;
  /** Limite haute du devicePixelRatio. */
  maxDpr: number;
  chromaticAberration: boolean;
}

export const QUALITY_PRESETS: Record<QualityProfile, QualityPreset> = {
  high: {
    msaa: 4,
    fxaa: false,
    shadowMapSize: 2048,
    shadowRadius: 3,
    bloomLevels: 6,
    reflectionScale: 0.5,
    portalScale: 0.6,
    particleDensity: 1,
    minScale: 0.75,
    maxScale: 1,
    cloudLayers: 3,
    maxDpr: 1.5,
    chromaticAberration: true,
  },
  balanced: {
    msaa: 0,
    fxaa: true,
    shadowMapSize: 2048,
    shadowRadius: 2.5,
    bloomLevels: 5,
    reflectionScale: 0.35,
    portalScale: 0.5,
    particleDensity: 0.7,
    minScale: 0.65,
    maxScale: 1,
    cloudLayers: 2,
    maxDpr: 1.25,
    chromaticAberration: true,
  },
  performance: {
    msaa: 0,
    fxaa: true,
    shadowMapSize: 1024,
    shadowRadius: 1.5,
    bloomLevels: 4,
    reflectionScale: 0,
    portalScale: 0.4,
    particleDensity: 0.45,
    minScale: 0.5,
    maxScale: 0.85,
    cloudLayers: 1,
    maxDpr: 1,
    chromaticAberration: false,
  },
};

/** Déduit un profil par défaut à partir du nom du GPU. */
export function detectQuality(gl: WebGL2RenderingContext | null): { profile: QualityProfile; gpu: string } {
  if (!gl) return { profile: 'performance', gpu: 'inconnu' };
  let gpu = 'inconnu';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    /* ignore */
  }
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(g)) return { profile: 'performance', gpu };
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m[1-9] (pro|max|ultra)|arc\(tm\) a/.test(g))
    return { profile: 'high', gpu };
  // Iris Xe, UHD, Radeon intégrés, Apple M de base, Adreno... → profil équilibré
  return { profile: 'balanced', gpu };
}
