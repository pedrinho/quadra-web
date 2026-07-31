/*
 * The settings overlay: key bindings and repeat sensitivity.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Stands in for `Menu_setup` (source/menu.cc:1025-1230), which draws the same settings into
 * the game's own framebuffer over images/setup.png. This port has no widget system yet, so
 * the panel is plain DOM over the canvas. The rebinding flow still follows the original:
 * a slot is armed, the next key pressed takes it, Escape cancels (menu.cc:1210-1230), and
 * "set all keys" walks the slots in the original's order (menu.cc:1177).
 */

import { ACTION_ORDER, RESERVED_KEYS, defaultSettings, keyLabel, type Settings } from '../settings.js';
import { SENSITIVITY_PRESETS, deriveRepeat } from '../engine/sensitivity.js';
import { TICK_MS } from '../engine/game.js';
import { ACTION_COUNT, type Action } from '../engine/canvas.js';

/** One playfield cell is 18px, and positions are tracked in 1/16ths of a pixel. */
const CELL_SUBPIXELS = 18 << 4;

export interface SettingsPanelOptions {
  host: HTMLElement;
  settings: Settings;
  /** Called on every change, with the full settings. */
  onChange: (settings: Settings) => void;
  /** Called when the panel opens (true) and closes (false), so the host can pause. */
  onVisibility?: (open: boolean) => void;
}

export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly settings: Settings;
  private readonly onChange: (settings: Settings) => void;
  private readonly onVisibility: ((open: boolean) => void) | undefined;

  private readonly keyButtons = new Map<Action, HTMLButtonElement>();
  private readonly hReadout: HTMLElement;
  private readonly vReadout: HTMLElement;
  private readonly hSlider: HTMLInputElement;
  private readonly vSlider: HTMLInputElement;
  private readonly continuousBox: HTMLInputElement;
  private readonly hint: HTMLElement;

  /** Slots still to be bound; the head is armed. Empty means not capturing. */
  private queue: Action[] = [];
  private open = false;

  constructor(opts: SettingsPanelOptions) {
    this.settings = opts.settings;
    this.onChange = opts.onChange;
    this.onVisibility = opts.onVisibility;

    this.root = document.createElement('div');
    this.root.className = 'settings';
    this.root.hidden = true;

    const presets = document.createElement('datalist');
    presets.id = 'sensitivity-presets';
    for (const p of SENSITIVITY_PRESETS) {
      const opt = document.createElement('option');
      opt.value = String(p.pct);
      opt.label = p.label;
      presets.append(opt);
    }

    this.hSlider = slider();
    this.vSlider = slider();
    this.hReadout = document.createElement('div');
    this.hReadout.className = 'readout';
    this.vReadout = document.createElement('div');
    this.vReadout.className = 'readout';
    this.continuousBox = document.createElement('input');
    this.continuousBox.type = 'checkbox';

    this.hSlider.addEventListener('input', () => {
      this.settings.hSensitivity = Number(this.hSlider.value);
      this.commit();
    });
    this.vSlider.addEventListener('input', () => {
      this.settings.vSensitivity = Number(this.vSlider.value);
      this.commit();
    });
    this.continuousBox.addEventListener('change', () => {
      this.settings.continuous = this.continuousBox.checked;
      this.commit();
    });

    const title = document.createElement('h2');
    title.textContent = 'Settings';
    const close = button('close', () => this.hide());
    close.className = 'close';

    const head = document.createElement('header');
    head.append(title, close);

    const speeds = document.createElement('div');
    speeds.className = 'group';
    speeds.append(
      sectionTitle('Sensitivity'),
      field('Horizontal', this.hSlider, this.hReadout),
      field('Vertical', this.vSlider, this.vReadout),
      checkboxRow('Continuous down', this.continuousBox, 'Keep soft-dropping into the next piece'),
      presets,
    );

    const keys = document.createElement('div');
    keys.className = 'group';
    keys.append(sectionTitle('Keys'));
    for (const { action, label } of ACTION_ORDER) {
      const b = button('', () => this.capture([action]));
      b.className = 'key';
      this.keyButtons.set(action, b);
      keys.append(row(label, b));
    }

    this.hint = document.createElement('div');
    this.hint.className = 'hint';

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Set all keys', () => this.capture(ACTION_ORDER.map((a) => a.action))),
      button('Reset to defaults', () => this.reset()),
    );

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.append(head, speeds, keys, actions, this.hint);
    this.root.append(panel);
    opts.host.append(this.root);

    // Capture phase, so an armed slot sees the key before Keyboard does.
    window.addEventListener('keydown', this.onKeyDown, true);

    this.render();
  }

  get isOpen(): boolean {
    return this.open;
  }

  get isCapturing(): boolean {
    return this.queue.length > 0;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.render();
    this.onVisibility?.(true);
  }

  hide(): void {
    if (!this.open) return;
    this.queue = [];
    this.open = false;
    this.root.hidden = true;
    this.onVisibility?.(false);
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  private capture(slots: Action[]): void {
    this.queue = slots;
    this.render();
  }

  private reset(): void {
    Object.assign(this.settings, defaultSettings());
    this.queue = [];
    this.commit();
  }

  private commit(): void {
    this.onChange(this.settings);
    this.render();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return;
    const armed = this.queue[0];
    if (armed === undefined) return;

    // Escape aborts the whole run, as `input->keys[1]` does in Menu_setup_all_key.
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      this.queue = [];
      this.render();
      return;
    }
    if (RESERVED_KEYS.has(e.code)) return;

    this.settings.keys[armed] = e.code;
    this.queue.shift();
    this.commit();
  };

  private render(): void {
    const armed = this.queue[0];

    this.hSlider.value = String(this.settings.hSensitivity);
    this.vSlider.value = String(this.settings.vSensitivity);
    this.continuousBox.checked = this.settings.continuous;

    const tuning = deriveRepeat(this.settings.hSensitivity, this.settings.vSensitivity);
    this.hReadout.textContent =
      `${this.settings.hSensitivity}%${presetSuffix(this.settings.hSensitivity)} · ` +
      `repeats every ${plural(tuning.hRepeatDelay, 'frame')} ` +
      `(${tuning.hRepeatDelay * TICK_MS} ms), first repeat after ` +
      `${(tuning.hRepeatDelay + 10) * TICK_MS} ms`;
    this.vReadout.textContent =
      `${this.settings.vSensitivity}%${presetSuffix(this.settings.vSensitivity)} · ` +
      `soft drop ≈ ${((tuning.downSpeed * 100) / CELL_SUBPIXELS).toFixed(1)} cells/sec`;

    for (const [action, b] of this.keyButtons) {
      const capturing = action === armed;
      b.textContent = capturing ? 'press a key…' : keyLabel(this.settings.keys[action] ?? '');
      b.classList.toggle('arming', capturing);
      b.classList.toggle('duplicate', !capturing && this.isDuplicate(action));
    }

    this.hint.textContent = armed === undefined
      ? 'Esc closes · settings are saved automatically'
      : 'Press the key to bind, or Esc to cancel';
  }

  /** Sharing a key is legal — the original ships that way — but worth flagging. */
  private isDuplicate(action: Action): boolean {
    const code = this.settings.keys[action];
    if (!code) return false;
    for (let i = 0; i < ACTION_COUNT; i++) {
      if (i !== action && this.settings.keys[i] === code) return true;
    }
    return false;
  }
}

/** One line describing the current bindings, for the help text under the canvas. */
export function bindingsHelp(settings: Settings): string {
  const k = (a: Action) => keyLabel(settings.keys[a] ?? '');
  const parts = ACTION_ORDER.map(({ action, label }) => `${k(action)} ${label.toLowerCase()}`);
  return `${parts.join(' · ')} · P pause · R restart · Esc settings`;
}

/* --- small DOM helpers --------------------------------------------------- */

function slider(): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'range';
  el.min = '0';
  el.max = '100';
  el.step = '1';
  el.setAttribute('list', 'sensitivity-presets');
  return el;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement('h3');
  el.textContent = text;
  return el;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  el.append(l, control);
  return el;
}

function field(label: string, control: HTMLElement, readout: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'field';
  el.append(row(label, control), readout);
  return el;
}

function checkboxRow(label: string, box: HTMLInputElement, note: string): HTMLElement {
  const el = row(label, box);
  const n = document.createElement('div');
  n.className = 'readout';
  n.textContent = note;
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.append(el, n);
  return wrap;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function presetSuffix(pct: number): string {
  const hit = SENSITIVITY_PRESETS.find((p) => p.pct === pct);
  return hit ? ` (${hit.label})` : '';
}
