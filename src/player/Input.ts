// Entrées : clavier (codes physiques → ZQSD et WASD fonctionnent tous deux),
// souris avec verrouillage du pointeur, manette (Gamepad API).

export class Input {
  private keys = new Set<string>();
  private mouseButtons = 0;
  lookDX = 0;
  lookDY = 0;
  pointerLocked = false;
  /** true si le joueur a demandé le verrouillage mais que le navigateur l'a refusé. */
  lockFailed = false;
  private onLockChange: ((locked: boolean) => void)[] = [];
  private pressedOnce = new Set<string>();
  enabled = true;
  /** Glisser-pour-regarder quand le pointeur n'est pas verrouillé. */
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  gamepadActive = false;
  private gpLook = { x: 0, y: 0 };
  private gpMove = { x: 0, y: 0 };
  private gpObserve = false;
  private gpRun = false;
  private gpStartPrev = false;
  onPauseRequest: (() => void) | null = null;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
    });
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', (e) => {
      if (this.pointerLocked || e.target === this.canvas) e.preventDefault();
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    // Empêche le défilement de la page avec espace / flèches pendant le jeu.
    if (this.pointerLocked && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code))
      e.preventDefault();
    this.keys.add(e.code);
    this.pressedOnce.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.pointerLocked) this.lockFailed = false;
    for (const f of this.onLockChange) f(this.pointerLocked);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      // Certains navigateurs envoient des sauts aberrants juste après le verrouillage.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    } else if (this.dragging) {
      this.lookDX += e.clientX - this.lastX;
      this.lookDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.mouseButtons |= 1 << e.button;
    if (!this.pointerLocked && this.lockFailed && e.target === this.canvas) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseButtons &= ~(1 << e.button);
    if (e.button === 0) this.dragging = false;
  };

  /** Simulation d'une touche (tests automatisés). */
  simulateKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  addLockListener(f: (locked: boolean) => void): void {
    this.onLockChange.push(f);
  }

  async requestLock(): Promise<void> {
    if (this.pointerLocked) return;
    try {
      // Mouvement brut (sans accélération Windows) quand c'est disponible.
      const anyCanvas = this.canvas as HTMLElement & {
        requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void;
      };
      try {
        await anyCanvas.requestPointerLock({ unadjustedMovement: true });
      } catch {
        await anyCanvas.requestPointerLock();
      }
    } catch {
      this.lockFailed = true;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  reset(): void {
    this.keys.clear();
    this.mouseButtons = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.dragging = false;
  }

  down(code: string): boolean {
    return this.enabled && this.keys.has(code);
  }

  /** Vrai une seule fois par pression. */
  pressed(code: string): boolean {
    if (!this.enabled) return false;
    const p = this.pressedOnce.has(code);
    if (p) this.pressedOnce.delete(code);
    return p;
  }

  /** Vecteur de déplacement (x = droite, y = avant), longueur ≤ 1. */
  moveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    x += this.gpMove.x;
    y += this.gpMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  running(): boolean {
    return this.down('ShiftLeft') || this.down('ShiftRight') || this.gpRun;
  }

  /** Observer : clic maintenu (gauche ou droit), Espace, ou gâchette. */
  observing(): boolean {
    if (!this.enabled) return false;
    const mouse = (this.pointerLocked || this.lockFailed) && (this.mouseButtons & 0b101) !== 0;
    return mouse || this.keys.has('Space') || this.keys.has('KeyE') || this.gpObserve;
  }

  /** Consomme le delta de regard accumulé (pixels). */
  consumeLook(): { dx: number; dy: number } {
    const dx = this.lookDX + this.gpLook.x;
    const dy = this.lookDY + this.gpLook.y;
    this.lookDX = 0;
    this.lookDY = 0;
    return { dx, dy };
  }

  /** À appeler à chaque image : lit la manette. */
  pollGamepad(dt: number): void {
    this.gpLook.x = 0;
    this.gpLook.y = 0;
    this.gpMove.x = 0;
    this.gpMove.y = 0;
    this.gpObserve = false;
    this.gpRun = false;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) pad = p;
    if (!pad) {
      this.gamepadActive = false;
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    const btn = (i: number) => !!pad!.buttons[i]?.pressed;
    const any = lx || ly || rx || ry || btn(0) || btn(7) || btn(6);
    if (any) this.gamepadActive = true;
    this.gpMove.x = lx;
    this.gpMove.y = -ly;
    // Courbe de réponse douce pour la visée.
    const curve = (v: number) => Math.sign(v) * v * v;
    this.gpLook.x = curve(rx) * 900 * dt;
    this.gpLook.y = curve(ry) * 650 * dt;
    this.gpObserve = btn(7) || btn(0) || btn(6);
    this.gpRun = btn(10) || btn(4);
    const start = btn(9);
    if (start && !this.gpStartPrev && this.onPauseRequest) this.onPauseRequest();
    this.gpStartPrev = start;
  }
}
