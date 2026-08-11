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

/**
 * What a host needs in order to drive a game's input, and nothing else.
 *
 * `Canvas` satisfies it directly, which is all a test or a local game needs. A host that
 * records or transmits its input hands the keyboard something else that satisfies it and
 * forwards — see `Game.inputSink`. Keeping this narrow is what stops input reaching the
 * simulation by a path nothing is watching.
 */
export interface InputSink {
  pressKey(i: Action): void;
  releaseKey(i: Action): void;
  applyBindings(codes: readonly string[]): void;
}

/**
 * Collapse per-action key codes into the canonical grouping: each action points at the
 * lowest action bound to the same physical key, so actions sharing a key share one sticky
 * slot. Canonical means `g[i] <= i` and `g[g[i]] === g[i]`, which is what lets a grouping
 * be validated without trusting where it came from.
 */
export function groupsFromBindings(codes: readonly string[]): Uint8Array {
  const groups = new Uint8Array(ACTION_COUNT);
  for (let i = 0; i < ACTION_COUNT; i++) {
    let group = i;
    for (let j = 0; j < i; j++) {
      if (codes[j] !== undefined && codes[j] === codes[i]) {
        group = groups[j]!;
        break;
      }
    }
    groups[i] = group;
  }
  return groups;
}

/*
 * The two palette indices the line-clear flash alternates between (source/player.cc:743-745).
 *
 * They are raw indices, not colours, and that is the point: `Canvas::change_level` copies all
 * 256 entries straight out of `images/fond<N>.png` and nothing recolours them at runtime, so the
 * flash picks up whatever each level's palette holds there. In every shipped palette that is
 * white and red — but the indices are what the original stores, so the indices are what this
 * stores.
 */
export const FLASH_BRIGHT = 255;
export const FLASH_DIM = 200;

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

  /*
   * The line-clear flash (`Canvas::flash` / `Canvas::color_flash`, source/canvas.h:97,115).
   *
   * Presentation only: the simulation writes these and never reads them back, so a host that
   * draws none of it plays an identical game — the same contract sound-events.ts and notices.ts
   * keep. They live here rather than in a render-side animator because the original puts them
   * here, and because it makes the flash a pure function of the Canvas: the replay viewer's
   * seek re-simulates from frame zero, so scrubbing lands on the right frame of the flash for
   * free.
   *
   * Deliberately absent from replay/hash.ts, alongside `bflash`, `tmp` and `moved`. Hashing
   * them would change every stored stateHash for a change that alters no game.
   */

  /**
   * Rows currently flashing, as absolute board indices — 0 means an unused slot, which is safe
   * because row 0 is up in the spawn buffer and never clears. Capped at 20, as the original is.
   */
  readonly flash = new Uint8Array(20);

  /**
   * Palette index the flash bars are painted in, or 0 for no flash. The two values it takes are
   * raw indices into the level's own palette, which `Canvas::change_level` copies wholesale out
   * of `images/fond<N>.png`: 255 is white and 200 is red in every one of them.
   */
  colorFlash = 0;

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
    this.applyKeyGroups(groupsFromBindings(codes));
  }

  /**
   * The grouping itself, which is the only part of the bindings the simulation can see —
   * `checkKey` and friends index through it. A recording of a game therefore has to carry
   * this, but never the key codes, which are purely the host's business.
   */
  keyGroups(): Uint8Array {
    return Uint8Array.from(this.keyGroup);
  }

  /**
   * Install a grouping and drop every sticky key, which is what rebinding mid-game does: the
   * slots have been shuffled underneath the state, so keeping it would leave a phantom key
   * held on an action nobody pressed.
   */
  applyKeyGroups(groups: readonly number[] | Uint8Array): void {
    this.setKeyGroups(groups);
    this.clearKeyAll();
  }

  /**
   * The grouping alone, leaving sticky state untouched. Separate from `applyKeyGroups` because
   * a recording carries the clear as its own step: something replaying one has to be able to
   * reproduce each half exactly where it happened.
   */
  setKeyGroups(groups: readonly number[] | Uint8Array): void {
    for (let i = 0; i < ACTION_COUNT; i++) this.keyGroup[i] = groups[i] ?? i;
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
