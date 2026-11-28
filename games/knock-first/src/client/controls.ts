import type { KnockControlInput, SceneAction, SceneSettings } from './sceneTypes';

export interface ControlCallbacks {
  action(action: SceneAction, down: boolean): void;
  pointerLock(locked: boolean): void;
  gesture(): void;
}

const editable = (target: EventTarget | null): boolean => target instanceof HTMLElement &&
  (!!target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'));

/** One input owner; blur and menu transitions always release every held control. */
export class FirstPersonControls {
  private keys = new Set<string>();
  private touchX = 0;
  private touchZ = 0;
  private touchRun = false;
  private touchQuiet = false;
  private touchInteract = false;
  private dragging = false;
  private active = false;
  private destroyed = false;
  yaw = 0;
  pitch = 0;

  constructor(private canvas: HTMLCanvasElement, private settings: () => SceneSettings, private callbacks: ControlCallbacks) {
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('mousemove', this.mouseMove);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('pointerlockchange', this.lockChanged);
    document.addEventListener('pointerlockerror', this.lockError);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.release();
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = Number.isFinite(yaw) ? yaw : 0;
    this.pitch = Math.max(-1.34, Math.min(1.34, Number.isFinite(pitch) ? pitch : 0));
  }

  look(dx: number, dy: number): void {
    if (!this.active || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const scale = 0.0022 * Math.max(0.2, Math.min(3, this.settings().sensitivity));
    this.yaw -= dx * scale;
    this.pitch = Math.max(-1.34, Math.min(1.34, this.pitch - dy * scale));
  }

  move(x: number, forward: number): void {
    this.touchX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.touchZ = Number.isFinite(forward) ? Math.max(-1, Math.min(1, forward)) : 0;
  }

  setRun(value: boolean): void { this.touchRun = value; }
  setQuiet(value: boolean): void { this.touchQuiet = value; }
  setInteract(value: boolean): void {
    if (this.touchInteract === value) return;
    this.touchInteract = value;
    if (value) this.callbacks.gesture();
    if (this.active) this.callbacks.action('interact', value);
  }

  input(): KnockControlInput {
    const enabled = this.active && !document.hidden;
    const x = enabled ? (Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + this.touchX) : 0;
    const z = enabled ? (Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) + this.touchZ) : 0;
    const magnitude = Math.max(1, Math.hypot(x, z));
    return {
      moveX: x / magnitude, moveZ: z / magnitude,
      yaw: this.yaw, pitch: this.pitch,
      run: enabled && (this.touchRun || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
      quiet: enabled && (this.touchQuiet || this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC')),
      interact: enabled && (this.touchInteract || this.keys.has('KeyE')),
    };
  }

  request(): void {
    if (this.destroyed) return;
    this.callbacks.gesture();
    this.canvas.focus({ preventScroll: true });
    if (this.settings().pointerLock && document.pointerLockElement !== this.canvas && matchMedia('(pointer:fine)').matches) {
      try {
        const pending = this.canvas.requestPointerLock();
        if (pending) pending.catch(() => this.callbacks.pointerLock(false));
      } catch { this.callbacks.pointerLock(false); }
    }
  }

  release(): void {
    const handHeld = this.keys.has('KeyE') || this.touchInteract;
    this.keys.clear();
    this.touchX = this.touchZ = 0;
    this.touchRun = this.touchQuiet = this.touchInteract = false;
    this.dragging = false;
    if (handHeld) this.callbacks.action('interact', false);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  destroy(): void {
    this.destroyed = true;
    this.release();
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('contextmenu', this.contextMenu);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('mousemove', this.mouseMove);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('pointerlockchange', this.lockChanged);
    document.removeEventListener('pointerlockerror', this.lockError);
  }

  private contextMenu = (event: Event): void => event.preventDefault();
  private pointerDown = (event: PointerEvent): void => {
    if (!this.active || event.pointerType === 'touch') return;
    if (event.button === 1) {
      event.preventDefault(); this.callbacks.action('mark', true); return;
    }
    if (event.button !== 0) return;
    this.request();
    if (!this.settings().pointerLock) this.dragging = true;
  };
  private pointerUp = (): void => { this.dragging = false; };
  private mouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement === this.canvas || this.dragging) this.look(event.movementX, event.movementY);
  };
  private keyDown = (event: KeyboardEvent): void => {
    if (!this.active || editable(event.target) || event.metaKey || event.altKey) return;
    const actions: Record<string, SceneAction> = { KeyE: 'interact', KeyQ: 'knock', KeyF: 'timer', KeyG: 'mark', KeyM: 'map', Escape: 'pause' };
    if (!event.repeat && (event.code in actions || /^(Key[WASDC]|Arrow|Shift|Control)/.test(event.code))) this.callbacks.gesture();
    if (event.code in actions) {
      if (!event.repeat) this.callbacks.action(actions[event.code], true);
      event.preventDefault();
    }
    if (/^(Key[WASDC]|Arrow|Shift|Control)/.test(event.code)) event.preventDefault();
    this.keys.add(event.code);
  };
  private keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'KeyE') this.callbacks.action('interact', false);
  };
  private blur = (): void => { this.release(); this.callbacks.pointerLock(false); };
  private visibility = (): void => { if (document.hidden) this.blur(); };
  private lockChanged = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked) this.release();
    this.callbacks.pointerLock(locked);
  };
  private lockError = (): void => this.callbacks.pointerLock(false);
}
