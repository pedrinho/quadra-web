/*
 * Player settings: key bindings, repeat sensitivity, and their persistence.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Stands in for source/cfgfile.cc, which dumps a raw C struct to `quadra.cfg`. Here the
 * shape is JSON in localStorage, but the layout still mirrors the original: bindings are
 * indexed by *action*, matching `config.player[p].key[0..4]` plus
 * `config.player2[p].key[0..1]` (source/cfgfile.h:55-71). One key per action, and the same
 * key may appear in more than one slot.
 *
 * Keys are stored as `KeyboardEvent.code`, which identifies a physical key independent of
 * layout — the browser's equivalent of the SDL scancodes the original stores.
 */

import { Action, ACTION_COUNT } from './engine/canvas.js';
import { DEFAULT_SENSITIVITY } from './engine/sensitivity.js';

export interface Settings {
  /** `KeyboardEvent.code` per Action slot, 0..6. */
  keys: string[];
  /** Horizontal repeat speed, 0-100%. */
  hSensitivity: number;
  /** Soft-drop speed, 0-100%. */
  vSensitivity: number;
  /** When false the soft-drop key must be re-pressed for each new piece. */
  continuous: boolean;
}

/**
 * The original binds UP to both rotate slots (source/cfgfile.cc:85-91), which works there
 * only because clearing one clears the other. That leaves no rotate-clockwise key at all,
 * so this port gives Z the counter-clockwise slot instead and keeps everything else.
 */
export const DEFAULT_KEYS: readonly string[] = (() => {
  const k: string[] = new Array<string>(ACTION_COUNT).fill('');
  k[Action.Left] = 'ArrowLeft';
  k[Action.Right] = 'ArrowRight';
  k[Action.RotateLeft] = 'KeyZ';
  k[Action.Down] = 'ArrowDown';
  k[Action.RotateRight] = 'ArrowUp';
  k[Action.Rotate180] = 'ShiftRight';
  k[Action.Drop] = 'Space';
  return k;
})();

/** Display order and labels, following the original's "set all keys" walk (menu.cc:1177). */
export const ACTION_ORDER: ReadonlyArray<{ action: Action; label: string }> = [
  { action: Action.Left, label: 'Move left' },
  { action: Action.Right, label: 'Move right' },
  { action: Action.Down, label: 'Move down' },
  { action: Action.RotateRight, label: 'Rotate clockwise' },
  { action: Action.RotateLeft, label: 'Rotate counterclockwise' },
  { action: Action.Rotate180, label: 'Rotate twice' },
  { action: Action.Drop, label: 'Instant drop' },
];

/** Keys the UI owns and refuses to hand to the game. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Escape']);

const STORAGE_KEY = 'quadra.settings.v1';

export function defaultSettings(): Settings {
  return {
    keys: [...DEFAULT_KEYS],
    hSensitivity: DEFAULT_SENSITIVITY,
    vSensitivity: DEFAULT_SENSITIVITY,
    continuous: true,
  };
}

const clampPercent = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SENSITIVITY;
  return Math.min(100, Math.max(0, Math.round(v)));
};

/**
 * Coerce anything into a usable Settings. The original clamps every field it reads back
 * rather than trusting the file (source/cfgfile.cc:147-163); a stored blob here is just as
 * untrusted, since the player can edit it.
 */
export function normalizeSettings(raw: unknown): Settings {
  const s = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return s;
  const o = raw as Record<string, unknown>;

  if (Array.isArray(o['keys'])) {
    for (let i = 0; i < ACTION_COUNT; i++) {
      const code = o['keys'][i];
      if (typeof code === 'string' && code !== '' && !RESERVED_KEYS.has(code)) s.keys[i] = code;
    }
  }
  s.hSensitivity = clampPercent(o['hSensitivity']);
  s.vSensitivity = clampPercent(o['vSensitivity']);
  if (typeof o['continuous'] === 'boolean') s.continuous = o['continuous'];
  return s;
}

/** Read the stored settings, falling back to defaults on anything unexpected. */
export function loadSettings(store: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  if (!store) return defaultSettings();
  try {
    const text = store.getItem(STORAGE_KEY);
    if (text === null) return defaultSettings();
    return normalizeSettings(JSON.parse(text));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(
  settings: Settings,
  store: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing and full quotas both throw here. Settings still apply for the
    // session; losing them on reload is better than failing to start.
  }
}

/** localStorage access itself throws in some privacy modes, so it is probed once. */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Human-readable name for a `KeyboardEvent.code`. */
export function keyLabel(code: string): string {
  if (!code) return '—';
  const named: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    MetaLeft: 'Left Meta',
    MetaRight: 'Right Meta',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    CapsLock: 'Caps Lock',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Backslash: '\\',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Minus: '-',
    Equal: '=',
  };
  const known = named[code];
  if (known) return known;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  return code;
}
