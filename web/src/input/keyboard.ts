/*
 * Keyboard input mapped onto Quadra's seven action slots.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The engine expects sticky key state: a press sets PRESSED and leaves it set until the
 * game clears it, a release replaces the state with RELEASED. Rotations fire on RELEASE,
 * which is unusual but is how the original reads (source/player.cc:305-410).
 *
 * Bindings are indexed by action, so one key may drive several actions. The canvas keeps
 * those slots sharing one sticky entry (Canvas.applyBindings), matching the original.
 */

import { Action, ACTION_COUNT, type Canvas } from '../engine/canvas.js';
import { DEFAULT_KEYS, RESERVED_KEYS } from '../settings.js';

/** Minimal surface of `window` this needs — lets tests pass a bare EventTarget. */
export type KeyboardTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export class Keyboard {
  private bindings: string[] = [...DEFAULT_KEYS];
  private byCode = new Map<string, Action[]>();
  private readonly held = new Set<string>();
  private canvas: Canvas | null = null;
  private suspended = false;
  private detach: (() => void) | null = null;

  constructor(bindings: readonly string[] = DEFAULT_KEYS) {
    this.setBindings(bindings);
  }

  /** Replace the bindings. Anything currently held is released first, so nothing sticks. */
  setBindings(bindings: readonly string[]): void {
    this.releaseAll();
    this.bindings = Array.from({ length: ACTION_COUNT }, (_, i) => bindings[i] ?? '');
    this.byCode = new Map();
    for (let action = 0; action < ACTION_COUNT; action++) {
      const code = this.bindings[action]!;
      if (!code || RESERVED_KEYS.has(code)) continue;
      const actions = this.byCode.get(code);
      if (actions) actions.push(action as Action);
      else this.byCode.set(code, [action as Action]);
    }
    this.canvas?.applyBindings(this.bindings);
  }

  /** True if the code drives any game action — lets the host yield hotkeys to bindings. */
  isBound(code: string): boolean {
    return this.byCode.has(code);
  }

  attach(target: KeyboardTarget, canvas: Canvas): void {
    this.dispose();
    this.canvas = canvas;
    canvas.applyBindings(this.bindings);

    const onDown = (e: KeyboardEvent) => {
      const actions = this.byCode.get(e.code);
      if (!actions) return;
      // While suspended the settings panel owns the keyboard, so bound keys must keep their
      // default behaviour — otherwise Space stops activating buttons and the arrows stop
      // nudging the sliders.
      if (this.suspended) return;
      e.preventDefault();
      // Ignore auto-repeat: the engine runs its own DAS, and letting the OS repeat would
      // fight it.
      if (this.held.has(e.code)) return;
      this.held.add(e.code);
      for (const action of actions) canvas.pressKey(action);
    };
    const onUp = (e: KeyboardEvent) => {
      const actions = this.byCode.get(e.code);
      if (!actions) return;
      // Not held means the press never reached the game — nothing to release.
      if (!this.held.delete(e.code)) return;
      e.preventDefault();
      for (const action of actions) canvas.releaseKey(action);
    };
    // Dropping every held key on blur avoids a key sticking down when focus is lost.
    const onBlur = () => this.releaseAll();

    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);
    this.detach = () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    };
  }

  /**
   * Stop feeding the game while still swallowing bound keys, so opening the settings panel
   * neither moves the piece nor scrolls the page.
   */
  suspend(): void {
    this.suspended = true;
    this.releaseAll();
  }

  resume(): void {
    this.suspended = false;
  }

  private releaseAll(): void {
    if (this.canvas) {
      for (const code of this.held) {
        for (const action of this.byCode.get(code) ?? []) this.canvas.releaseKey(action);
      }
    }
    this.held.clear();
  }

  dispose(): void {
    this.releaseAll();
    this.detach?.();
    this.detach = null;
    this.canvas = null;
  }
}
