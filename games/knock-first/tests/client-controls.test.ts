import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstPersonControls } from '../src/client/controls';
import { DEFAULT_SCENE_SETTINGS } from '../src/client/sceneTypes';

// Unit-only EventTargets. These tests do not exercise a browser or real pointer lock.
class ElementTarget extends EventTarget {
  focus = vi.fn();
  closest(): null { return null; }
}
class DocumentTarget extends EventTarget {
  hidden = false;
  pointerLockElement: ElementTarget | null = null;
  exitPointerLock = vi.fn(() => {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  });
}
function dispatch(target: EventTarget, type: string, values: Record<string, unknown> = {}): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, values);
  target.dispatchEvent(event);
}

describe('controls release and lifecycle (mocked DOM)', () => {
  let win: EventTarget, doc: DocumentTarget, canvas: ElementTarget;
  let controls: FirstPersonControls;
  const callbacks = { action: vi.fn(), pointerLock: vi.fn(), gesture: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    win = new EventTarget(); doc = new DocumentTarget(); canvas = new ElementTarget();
    vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('HTMLElement', ElementTarget);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    controls = new FirstPersonControls(canvas as unknown as HTMLCanvasElement, () => ({ ...DEFAULT_SCENE_SETTINGS, pointerLock: false }), callbacks);
    controls.setActive(true);
  });
  afterEach(() => { controls.destroy(); vi.unstubAllGlobals(); });

  it('releases keyboard, touch movement, run and held hand on blur', () => {
    dispatch(win, 'keydown', { code: 'KeyW' });
    dispatch(win, 'keydown', { code: 'KeyE' });
    controls.move(0.7, 0.4); controls.setRun(true); controls.setQuiet(true); controls.setInteract(true);
    expect(controls.input().interact).toBe(true);
    dispatch(win, 'blur');
    expect(controls.input()).toMatchObject({ moveX: 0, moveZ: 0, run: false, quiet: false, interact: false });
    expect(callbacks.action).toHaveBeenLastCalledWith('interact', false);
  });

  it('pointer-lock loss releases both keyboard and touch state', () => {
    controls.move(-1, 0.5); controls.setRun(true); controls.setInteract(true);
    doc.pointerLockElement = null;
    dispatch(doc, 'pointerlockchange');
    expect(controls.input()).toMatchObject({ moveX: 0, moveZ: 0, run: false, interact: false });
    expect(callbacks.pointerLock).toHaveBeenLastCalledWith(false);
  });

  it('menu deactivation sends hand-up and reopening does not restore stale movement', () => {
    dispatch(win, 'keydown', { code: 'KeyW' }); dispatch(win, 'keydown', { code: 'KeyE' });
    controls.setActive(false);
    dispatch(win, 'keydown', { code: 'KeyQ' });
    controls.setActive(true);
    expect(controls.input()).toMatchObject({ moveX: 0, moveZ: 0, interact: false });
    expect(callbacks.action).not.toHaveBeenCalledWith('knock', true);
    expect(callbacks.action).toHaveBeenLastCalledWith('interact', false);
  });

  it('drag look works without pointer lock and stops on pointer-up', () => {
    dispatch(canvas, 'pointerdown', { pointerType: 'mouse', button: 0 });
    dispatch(win, 'mousemove', { movementX: 100, movementY: -100 });
    const moved = controls.input();
    expect(moved.yaw).toBeLessThan(0); expect(moved.pitch).toBeGreaterThan(0);
    dispatch(win, 'pointerup'); dispatch(win, 'mousemove', { movementX: 100, movementY: 100 });
    expect(controls.input()).toEqual(moved);
  });

  it('normalizes simultaneous touch and keyboard effort and excludes non-finite axes', () => {
    dispatch(win, 'keydown', { code: 'KeyW' }); controls.move(1, 1);
    expect(Math.hypot(controls.input().moveX, controls.input().moveZ)).toBeCloseTo(1);
    dispatch(win, 'keyup', { code: 'KeyW' }); controls.move(NaN, Infinity);
    expect(controls.input()).toMatchObject({ moveX: 0, moveZ: 0 });
  });

  it('destroy removes gesture/action event listeners', () => {
    controls.destroy(); callbacks.action.mockClear(); callbacks.gesture.mockClear();
    dispatch(win, 'keydown', { code: 'KeyQ' });
    dispatch(canvas, 'pointerdown', { pointerType: 'mouse', button: 0 });
    expect(callbacks.action).not.toHaveBeenCalled(); expect(callbacks.gesture).not.toHaveBeenCalled();
  });
});
