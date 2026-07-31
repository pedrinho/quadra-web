/*
 * Keyboard input mapped onto Quadra's seven action slots.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The engine expects sticky key state: a press sets PRESSED and leaves it set until the
 * game clears it, a release replaces the state with RELEASED. Rotations fire on RELEASE,
 * which is unusual but is how the original reads (source/player.cc:305-410).
 */

import { Action, type Canvas } from '../engine/canvas.js';

/** Defaults from cfgfile.cc:51-93 — arrows, RSHIFT for the 180 spin, SPACE to hard drop. */
export const DEFAULT_BINDINGS: Record<string, Action> = {
  ArrowLeft: Action.Left,
  ArrowRight: Action.Right,
  ArrowUp: Action.RotateRight,
  ArrowDown: Action.Down,
  KeyZ: Action.RotateLeft,
  KeyX: Action.RotateRight,
  ShiftRight: Action.Rotate180,
  Space: Action.Drop,
};

export class Keyboard {
  private readonly bindings: Record<string, Action>;
  private readonly held = new Set<string>();
  private detach: (() => void) | null = null;

  constructor(bindings: Record<string, Action> = DEFAULT_BINDINGS) {
    this.bindings = bindings;
  }

  attach(target: Window, canvas: Canvas): void {
    const onDown = (e: KeyboardEvent) => {
      const action = this.bindings[e.code];
      if (action === undefined) return;
      e.preventDefault();
      // Ignore auto-repeat: the engine runs its own DAS, and letting the OS repeat would
      // fight it.
      if (this.held.has(e.code)) return;
      this.held.add(e.code);
      canvas.pressKey(action);
    };
    const onUp = (e: KeyboardEvent) => {
      const action = this.bindings[e.code];
      if (action === undefined) return;
      e.preventDefault();
      this.held.delete(e.code);
      canvas.releaseKey(action);
    };
    // Dropping every held key on blur avoids a key sticking down when focus is lost.
    const onBlur = () => {
      for (const code of this.held) {
        const action = this.bindings[code];
        if (action !== undefined) canvas.releaseKey(action);
      }
      this.held.clear();
    };

    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);
    this.detach = () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }
}
