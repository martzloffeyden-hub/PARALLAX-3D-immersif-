// Paramètres utilisateur persistants (localStorage, toujours protégé par try/catch).

export type QualityProfile = 'high' | 'balanced' | 'performance';

export interface SettingsData {
  quality: QualityProfile;
  adaptiveResolution: boolean;
  /** Échelle de résolution de base (0.5 – 1). */
  renderScale: number;
  targetFps: 30 | 60;
  showFps: boolean;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  headBob: boolean;
  reducedMotion: boolean;
  hints: boolean;
  volMaster: number;
  volMusic: number;
  volSfx: number;
}

const KEY = 'parallax.settings.v1';
const PROGRESS_KEY = 'parallax.progress.v1';

export const QUALITY_DEFAULT_SCALE: Record<QualityProfile, number> = {
  high: 1.0,
  balanced: 0.85,
  performance: 0.7,
};

export function defaultSettings(quality: QualityProfile = 'balanced'): SettingsData {
  return {
    quality,
    adaptiveResolution: true,
    renderScale: QUALITY_DEFAULT_SCALE[quality],
    targetFps: 60,
    showFps: false,
    sensitivity: 1,
    invertY: false,
    fov: 72,
    headBob: true,
    reducedMotion: false,
    hints: true,
    volMaster: 0.8,
    volMusic: 0.75,
    volSfx: 0.85,
  };
}

type Listener = (s: SettingsData, changed: keyof SettingsData | null) => void;

export class Settings {
  data: SettingsData;
  /** true si aucun réglage n'existait (premier lancement). */
  readonly firstRun: boolean;
  private listeners: Listener[] = [];

  constructor(detectedQuality: QualityProfile) {
    let stored: Partial<SettingsData> | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) stored = JSON.parse(raw) as Partial<SettingsData>;
    } catch {
      stored = null;
    }
    this.firstRun = !stored;
    this.data = { ...defaultSettings(detectedQuality), ...(stored ?? {}) };
    this.sanitize();
  }

  private sanitize(): void {
    const d = this.data;
    if (!['high', 'balanced', 'performance'].includes(d.quality)) d.quality = 'balanced';
    d.renderScale = Math.min(1, Math.max(0.5, Number(d.renderScale) || 0.85));
    d.sensitivity = Math.min(3, Math.max(0.2, Number(d.sensitivity) || 1));
    d.fov = Math.min(95, Math.max(55, Number(d.fov) || 72));
    d.targetFps = d.targetFps === 30 ? 30 : 60;
    for (const k of ['volMaster', 'volMusic', 'volSfx'] as const) {
      const v = Number(d[k]);
      d[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
    }
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    this.sanitize();
    this.save();
    for (const l of this.listeners) l(this.data, key);
  }

  /** Applique un profil graphique complet (et l'échelle de rendu associée). */
  applyQuality(q: QualityProfile): void {
    this.data.quality = q;
    this.data.renderScale = QUALITY_DEFAULT_SCALE[q];
    this.save();
    for (const l of this.listeners) l(this.data, 'quality');
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* stockage indisponible : on continue sans persistance */
    }
  }
}

export interface ProgressData {
  /** Plus haut chapitre atteint (1..3). */
  reached: number;
  completed: boolean;
}

export const Progress = {
  load(): ProgressData {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<ProgressData>;
        return { reached: Math.min(3, Math.max(0, Number(p.reached) || 0)), completed: !!p.completed };
      }
    } catch {
      /* ignore */
    }
    return { reached: 0, completed: false };
  },
  save(p: ProgressData): void {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  },
};
