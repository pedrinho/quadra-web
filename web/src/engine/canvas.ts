/*
 * Port of the player-facing parts of source/canvas.cc / canvas.h in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { Board } from './board.js';
import { Bloc } from './bloc.js';
import { Random } from './random.js';
import { DEFAULT_SENSITIVITY, deriveRepeat } from './sensitivity.js';

/** Key state bits, from source/input.h:30-31. Keys are sticky: a press leaves PRESSED set
 *  until cleared, and a release replaces the state with RELEASED. */
export const PRESSED = 1;
export const RELEASED = 2;

/**
 * Action slots. The original indexes `config.player[p].key[0..4]` and
 * `config.player2[p].key[0..1]`; the mapping is in Player_process_key::keyboard_control
 * (source/player.cc:298-422).
 */
export const enum Action {
  Left = 0,
  Right = 1,
  RotateLeft = 2,
  Down = 3,
  RotateRight = 4,
  Rotate180 = 5,
  Drop = 6,
}
export const ACTION_COUNT = 7;

/** One queued garbage line. */
export interface BonusLine {
  color: number;
  blindTime: number;
  /** 10-bit mask of hole columns; bit 9 is the leftmost playfield column. */
  holePos: number;
  /** True for the last line of an attack burst. */
  final: boolean;
}

/**
 * A single player's playfield: the board, the falling piece, the next queue, input state
 * and the tuning derived from the player's repeat-speed settings.
 */
export class Canvas extends Board {
  bloc: Bloc | null = null;
  blocShadow: Bloc | null = null;
  next: Bloc | null = null;
  next2: Bloc | null = null;
  next3: Bloc | null = null;

  readonly rnd: Random;

  /**
   * Sticky key state, one entry per Action.
   *
   * The original keys this by physical scancode and resolves the binding on every read
   * (source/canvas.cc:831-855), which is what makes one key bound to two slots behave
   * sensibly: clearing the first also clears the second. Here the state is per-action, so
   * `keyGroup` reproduces that sharing — see `applyBindings`.
   */
  readonly keys = new Uint8Array(ACTION_COUNT);

  /**
   * Action -> canonical action for the physical key it is bound to. Identity unless two
   * actions share a key, in which case both map to the lower slot and therefore share one
   * entry in `keys`.
   */
  private readonly keyGroup = Uint8Array.from({ length: ACTION_COUNT }, (_, i) => i);

  /* Repeat tuning, 0-100%, from the player's settings. reinit() derives the rest. */
  hSensitivity = DEFAULT_SENSITIVITY;
  vSensitivity = DEFAULT_SENSITIVITY;
  hRepeatDelay = 3;
  vRepeatDelay = 3;
  /** Cosmetic horizontal chase speed, 1/16-px per frame. */
  sideSpeed = 96;
  /** Soft-drop speed, 1/16-px per frame. */
  downSpeed = 113;

  /** When false, the soft-drop key is cleared on each new piece so it must be re-pressed. */
  continuous = true;
  /** Draw the ghost piece. */
  shadow = false;

  /** Column of the last cell stamped; seeds attack targeting in the original. */
  lastX = 0;

  /** Frame the current piece was spawned on. */
  frameStart = 0;

  /* Stats. */
  score = 0;
  /** Lines toward the next level-up. Not reset on level up — the threshold is cumulative. */
  linesCur = 0;
  linesTot = 0;

  /** Queued incoming garbage, oldest first. */
  readonly bon: BonusLine[] = [];

  /** Set once the player tops out. */
  dead = false;

  constructor(seed: number | bigint = 0) {
    super();
    this.rnd = new Random(seed);
    this.reinit();
  }

  /**
   * Re-derive the repeat tuning from the sensitivity percentages. Safe to call mid-game:
   * every consumer reads these fields fresh each frame.
   */
  reinit(): void {
    const t = deriveRepeat(this.hSensitivity, this.vSensitivity);
    this.hRepeatDelay = t.hRepeatDelay;
    this.sideSpeed = t.sideSpeed;
    this.vRepeatDelay = t.vRepeatDelay;
    this.downSpeed = t.downSpeed;
  }

  /* --- input ------------------------------------------------------------- */

  /**
   * Tell the canvas which physical key drives each action, so that actions sharing a key
   * also share their sticky state. `codes` is indexed by Action; entries may repeat.
   */
  applyBindings(codes: readonly string[]): void {
    for (let i = 0; i < ACTION_COUNT; i++) {
      let group = i;
      for (let j = 0; j < i; j++) {
        if (codes[j] !== undefined && codes[j] === codes[i]) {
          group = this.keyGroup[j]!;
          break;
        }
      }
      this.keyGroup[i] = group;
    }
    this.clearKeyAll();
  }

  checkKey(i: Action): number {
    return this.keys[this.keyGroup[i]!]!;
  }

  clearKey(i: Action): void {
    this.keys[this.keyGroup[i]!] = 0;
  }

  clearKeyAll(): void {
    this.keys.fill(0);
  }

  /** Drop only the RELEASED bit, leaving PRESSED intact — used by auto-repeating actions. */
  unreleaseKey(i: Action): void {
    this.keys[this.keyGroup[i]!]! &= ~RELEASED;
  }

  /** Called by the host when a key goes down. Presses are sticky (`|=`). */
  pressKey(i: Action): void {
    this.keys[this.keyGroup[i]!]! |= PRESSED;
  }

  /** Called by the host when a key goes up. A release *replaces* the state. */
  releaseKey(i: Action): void {
    this.keys[this.keyGroup[i]!] = RELEASED;
  }

  /* --- collision --------------------------------------------------------- */

  /** `Canvas::collide` — test the current piece at a hypothetical position. */
  collide(px: number, py: number, rot: number): boolean {
    if (!this.bloc) return false;
    return this.checkCollide(this.bloc.quel, px, py, rot);
  }

  /* --- ghost piece ------------------------------------------------------- */

  /** Drop a copy of the current piece to where it would land. */
  calcShadow(): void {
    if (!this.bloc) {
      this.blocShadow = null;
      return;
    }
    const s = this.bloc.clone();
    while (!this.checkCollide(s.quel, s.bx, s.by + 1, s.rot)) s.by++;
    s.calcXY();
    this.blocShadow = s;
  }
}
