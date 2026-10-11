// Chronologie d'événements scriptés : déclencheurs ponctuels et intervalles animés.

interface AtEvent {
  t: number;
  fn: () => void;
  done: boolean;
}

interface Span {
  t0: number;
  t1: number;
  fn: (k: number, dt: number) => void;
  started: boolean;
  ended: boolean;
}

export class Sequence {
  t = 0;
  private events: AtEvent[] = [];
  private spans: Span[] = [];
  private end = 0;
  finished = false;
  onFinish: (() => void) | null = null;

  /** Déclenche `fn` une fois au temps `t`. */
  at(t: number, fn: () => void): this {
    this.events.push({ t, fn, done: false });
    this.end = Math.max(this.end, t);
    return this;
  }

  /** Appelle `fn(k)` avec k ∈ [0,1] entre t0 et t1 (k = 1 garanti à la fin). */
  span(t0: number, t1: number, fn: (k: number, dt: number) => void): this {
    this.spans.push({ t0, t1, fn, started: false, ended: false });
    this.end = Math.max(this.end, t1);
    return this;
  }

  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;
    for (const s of this.spans) {
      if (s.ended || this.t < s.t0) continue;
      const k = Math.min(1, (this.t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
      s.started = true;
      s.fn(k, dt);
      if (k >= 1) s.ended = true;
    }
    for (const e of this.events) {
      if (!e.done && this.t >= e.t) {
        e.done = true;
        e.fn();
      }
    }
    if (this.t >= this.end) {
      this.finished = true;
      this.onFinish?.();
    }
  }

  /** Termine immédiatement (exécute tout ce qui reste). */
  skipToEnd(): void {
    this.update(this.end - this.t + 1e-3);
  }
}
