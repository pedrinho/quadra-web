/*
 * Port of the player-facing parts of source/canvas.cc / canvas.h in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { Board } from './board.js';
import { Bloc } from './bloc.js';
import { Random } from './random.js';

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

  /** Sticky key state, one entry per Action. */
  readonly keys = new Uint8Array(ACTION_COUNT);

  /* Repeat tuning, 0..3, from the player's config. reinit() derives the rest. */
  hRepeat = 2;
  vRepeat = 2;
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
   * `Canvas::reinit` repeat-speed derivation — source/canvas.cc:214-245.
   * Integer division throughout, matching C++.
   */
  reinit(): void {
    const delays = [11, 6, 3, 1];
    this.hRepeatDelay = delays[this.hRepeat] ?? 3;
    this.sideSpeed = ((18 << 4) / this.hRepeatDelay) | 0;
    this.vRepeatDelay = delays[this.vRepeat] ?? 3;
    this.downSpeed = (340 / this.vRepeatDelay) | 0;
    if (this.downSpeed > 180) this.downSpeed = 180;
  }

  /* --- input ------------------------------------------------------------- */

  checkKey(i: Action): number {
    return this.keys[i]!;
  }

  clearKey(i: Action): void {
    this.keys[i] = 0;
  }

  clearKeyAll(): void {
    this.keys.fill(0);
  }

  /** Drop only the RELEASED bit, leaving PRESSED intact — used by auto-repeating actions. */
  unreleaseKey(i: Action): void {
    this.keys[i]! &= ~RELEASED;
  }

  /** Called by the host when a key goes down. Presses are sticky (`|=`). */
  pressKey(i: Action): void {
    this.keys[i]! |= PRESSED;
  }

  /** Called by the host when a key goes up. A release *replaces* the state. */
  releaseKey(i: Action): void {
    this.keys[i] = RELEASED;
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
