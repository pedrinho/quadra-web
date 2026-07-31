import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SENSITIVITY,
  SENSITIVITY_PRESETS,
  delayFromPercent,
  deriveRepeat,
} from '../src/engine/sensitivity.js';
import {
  DEFAULT_KEYS,
  defaultSettings,
  keyLabel,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../src/settings.js';
import { Action, ACTION_COUNT } from '../src/engine/canvas.js';

/** Minimal stand-in for localStorage — the real one does not exist under node. */
class MemoryStore {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe('sensitivity mapping', () => {
  it('maps percent onto the original delay range', () => {
    expect(delayFromPercent(0)).toBe(11);
    expect(delayFromPercent(25)).toBe(9);
    expect(delayFromPercent(50)).toBe(6);
    expect(delayFromPercent(75)).toBe(4);
    expect(delayFromPercent(80)).toBe(3);
    expect(delayFromPercent(100)).toBe(1);
  });

  it('clamps anything out of range', () => {
    expect(delayFromPercent(-50)).toBe(11);
    expect(delayFromPercent(1000)).toBe(1);
    expect(delayFromPercent(Number.NaN)).toBe(delayFromPercent(DEFAULT_SENSITIVITY));
  });

  it('reproduces the original preset table exactly', () => {
    // Slow / Normal / Fast / Faster from the switch in source/canvas.cc:229-245.
    const expected = [
      { pct: 0, delay: 11, sideSpeed: 26, downSpeed: 30 },
      { pct: 50, delay: 6, sideSpeed: 48, downSpeed: 56 },
      { pct: 80, delay: 3, sideSpeed: 96, downSpeed: 113 },
      { pct: 100, delay: 1, sideSpeed: 288, downSpeed: 180 },
    ];
    // The four named settings must all still be reachable on the slider.
    expect(expected.map((e) => e.pct)).toEqual(SENSITIVITY_PRESETS.map((p) => p.pct));

    for (const e of expected) {
      const t = deriveRepeat(e.pct, e.pct);
      expect({ pct: e.pct, ...t }).toEqual({
        pct: e.pct,
        hRepeatDelay: e.delay,
        vRepeatDelay: e.delay,
        sideSpeed: e.sideSpeed,
        downSpeed: e.downSpeed,
      });
    }
  });

  it('clamps down speed at 180, so 100% is slower than 340/1 suggests', () => {
    expect((340 / delayFromPercent(100)) | 0).toBe(340);
    expect(deriveRepeat(100, 100).downSpeed).toBe(180);
  });

  it('defaults to what the port did before sensitivity was configurable', () => {
    const t = deriveRepeat(DEFAULT_SENSITIVITY, DEFAULT_SENSITIVITY);
    expect(t).toEqual({ hRepeatDelay: 3, vRepeatDelay: 3, sideSpeed: 96, downSpeed: 113 });
  });

  it('tracks the axes independently', () => {
    const t = deriveRepeat(0, 100);
    expect(t.hRepeatDelay).toBe(11);
    expect(t.downSpeed).toBe(180);
  });
});

describe('settings persistence', () => {
  it('round-trips through storage', () => {
    const store = new MemoryStore();
    const s = defaultSettings();
    s.hSensitivity = 33;
    s.keys[Action.Left] = 'KeyA';
    s.continuous = false;
    saveSettings(s, store);
    expect(loadSettings(store)).toEqual(s);
  });

  it('falls back to defaults when nothing is stored', () => {
    expect(loadSettings(new MemoryStore())).toEqual(defaultSettings());
  });

  it('falls back to defaults on a malformed blob rather than throwing', () => {
    const store = new MemoryStore();
    store.setItem('quadra.settings.v1', '{not json');
    expect(loadSettings(store)).toEqual(defaultSettings());
  });

  it('clamps and ignores junk fields instead of trusting them', () => {
    const s = normalizeSettings({
      hSensitivity: 900,
      vSensitivity: -12,
      continuous: 'yes',
      keys: ['KeyA', 42, null, '', 'Escape'],
    });
    expect(s.hSensitivity).toBe(100);
    expect(s.vSensitivity).toBe(0);
    // Not a boolean, so the default stands.
    expect(s.continuous).toBe(true);
    expect(s.keys[Action.Left]).toBe('KeyA');
    // Non-strings, blanks and reserved keys all leave the default in place.
    expect(s.keys[Action.Right]).toBe(DEFAULT_KEYS[Action.Right]);
    expect(s.keys[Action.RotateRight]).toBe(DEFAULT_KEYS[Action.RotateRight]);
    expect(s.keys).toHaveLength(ACTION_COUNT);
  });

  it('survives storage being unavailable', () => {
    expect(loadSettings(null)).toEqual(defaultSettings());
    expect(() => saveSettings(defaultSettings(), null)).not.toThrow();
  });

  it('binds every action by default', () => {
    expect(DEFAULT_KEYS.filter((k) => k !== '')).toHaveLength(ACTION_COUNT);
  });
});

describe('key labels', () => {
  it('renders codes the way a player recognises them', () => {
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('KeyZ')).toBe('Z');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('ShiftRight')).toBe('Right Shift');
    expect(keyLabel('Numpad5')).toBe('Numpad 5');
    expect(keyLabel('F1')).toBe('F1');
    expect(keyLabel('')).toBe('—');
  });
});
