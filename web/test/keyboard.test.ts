import { describe, it, expect } from 'vitest';
import { Keyboard, type KeyboardTarget } from '../src/input/keyboard.js';
import { Action, Canvas, PRESSED, RELEASED } from '../src/engine/canvas.js';
import { DEFAULT_KEYS } from '../src/settings.js';

/** Enough of `window` for Keyboard, without pulling in jsdom. */
class FakeWindow {
  private readonly listeners = new Map<string, Set<(e: Event) => void>>();

  addEventListener(type: string, fn: (e: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  key(type: 'keydown' | 'keyup', code: string): { defaultPrevented: boolean } {
    const e = { code, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of this.listeners.get(type) ?? []) fn(e as unknown as Event);
    return e;
  }

  blur(): void {
    for (const fn of this.listeners.get('blur') ?? []) fn({} as Event);
  }
}

const setup = (keys: readonly string[] = DEFAULT_KEYS) => {
  const win = new FakeWindow();
  const canvas = new Canvas(1);
  const keyboard = new Keyboard(keys);
  keyboard.attach(win as unknown as KeyboardTarget, canvas);
  return { win, canvas, keyboard };
};

describe('keyboard', () => {
  it('presses and releases the action a key is bound to', () => {
    const { win, canvas } = setup();
    win.key('keydown', 'ArrowLeft');
    expect(canvas.checkKey(Action.Left)).toBe(PRESSED);
    win.key('keyup', 'ArrowLeft');
    expect(canvas.checkKey(Action.Left)).toBe(RELEASED);
  });

  it('ignores keys that are not bound, and does not swallow them', () => {
    const { win, canvas } = setup();
    const e = win.key('keydown', 'KeyQ');
    expect(e.defaultPrevented).toBe(false);
    expect(canvas.keys.every((v) => v === 0)).toBe(true);
  });

  it('swallows OS auto-repeat so it cannot fight the engine DAS', () => {
    const { win, canvas } = setup();
    win.key('keydown', 'ArrowLeft');
    canvas.clearKey(Action.Left); // as the engine would, mid-move
    win.key('keydown', 'ArrowLeft'); // the OS repeating the same physical press
    expect(canvas.checkKey(Action.Left)).toBe(0);
  });

  it('presses every action a shared key is bound to', () => {
    const keys = [...DEFAULT_KEYS];
    keys[Action.RotateLeft] = 'ArrowUp';
    keys[Action.RotateRight] = 'ArrowUp';
    const { win, canvas } = setup(keys);

    win.key('keydown', 'ArrowUp');
    expect(canvas.checkKey(Action.RotateLeft)).toBe(PRESSED);
    expect(canvas.checkKey(Action.RotateRight)).toBe(PRESSED);
    // They share one sticky entry, so clearing one clears the other — see Canvas.keyGroup.
    canvas.clearKey(Action.RotateLeft);
    expect(canvas.checkKey(Action.RotateRight)).toBe(0);
  });

  it('releases everything on blur, so nothing sticks down', () => {
    const { win, canvas } = setup();
    win.key('keydown', 'ArrowLeft');
    win.blur();
    expect(canvas.checkKey(Action.Left)).toBe(RELEASED);
    // The key is no longer considered held, so the next press registers.
    canvas.clearKey(Action.Left);
    win.key('keydown', 'ArrowLeft');
    expect(canvas.checkKey(Action.Left)).toBe(PRESSED);
  });

  it('rebinds live, releasing whatever was held', () => {
    const { win, canvas, keyboard } = setup();
    win.key('keydown', 'ArrowLeft');
    keyboard.setBindings([...DEFAULT_KEYS].map((k, i) => (i === Action.Left ? 'KeyA' : k)));

    // The old binding is dead and the new one works.
    win.key('keydown', 'ArrowLeft');
    expect(canvas.checkKey(Action.Left)).toBe(0);
    win.key('keydown', 'KeyA');
    expect(canvas.checkKey(Action.Left)).toBe(PRESSED);
  });

  it('hands bound keys back to the page while suspended', () => {
    const { win, canvas, keyboard } = setup();
    keyboard.suspend();
    const e = win.key('keydown', 'ArrowLeft');
    expect(canvas.checkKey(Action.Left)).toBe(0);
    // The settings panel owns the keyboard while it is open, so Space must still activate
    // its buttons and the arrows must still nudge its sliders.
    expect(e.defaultPrevented).toBe(false);

    keyboard.resume();
    win.key('keydown', 'ArrowLeft');
    expect(canvas.checkKey(Action.Left)).toBe(PRESSED);
    expect(win.key('keydown', 'ArrowRight').defaultPrevented).toBe(true);
  });

  it('releases a key that went down before it was suspended', () => {
    const { win, canvas, keyboard } = setup();
    win.key('keydown', 'ArrowLeft');
    keyboard.suspend();
    expect(canvas.checkKey(Action.Left)).toBe(RELEASED);
    // The matching keyup arrives later and must be a no-op, not a second release.
    canvas.clearKey(Action.Left);
    win.key('keyup', 'ArrowLeft');
    expect(canvas.checkKey(Action.Left)).toBe(0);
  });

  it('reports which codes are bound, so hotkeys can yield to them', () => {
    const keys = [...DEFAULT_KEYS];
    keys[Action.Drop] = 'KeyP';
    const { keyboard } = setup(keys);
    expect(keyboard.isBound('KeyP')).toBe(true);
    expect(keyboard.isBound('KeyR')).toBe(false);
  });
});
