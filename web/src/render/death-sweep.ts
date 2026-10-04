/*
 * The wipe that greys the stack when a player dies.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Port of `Player_dead::step` (source/player.cc:1223-1267). Every other tick it recolours one
 * cell in each quadrant of the well, keeping the cell's edge mask and swapping its colour for
 * colour 8 (`couleur = 8<<4`, :1165 — single player has no fragger to take the colour of). The walk
 * starts in the outermost columns and moves inward a column pair at a time; inside a column it
 * runs from the top and bottom edges towards the middle row. A sample marks each column as it
 * finishes. 55 cells per quadrant, so a little over a second.
 *
 * It lives out here, not in `src/engine/`, although the original runs it as a player module.
 * The port's game is over on the tick the piece cannot spawn: that is where a tape ends, where
 * the verifier stops and what every stored state hash was taken at. Moving it a hundred-odd ticks
 * later would change the outcome of every recorded game for the sake of an animation that changes
 * none. It only recolours what is already there, so it is a pure function of how long the board
 * has been dead, and that is something a host can tell it.
 */

import { TICK_MS } from '../engine/game.js';

/** Cells each quadrant greys: rows 11..21 by columns 4..8 (source/player.cc:1216-1217, :1228). */
const ROWS_PER_COLUMN = 11;
const COLUMNS = 5;
export const SWEEP_STEPS = ROWS_PER_COLUMN * COLUMNS;

/**
 * Ticks from the one the game ended on to the one the last cell greys. The first step runs the
 * tick after (a module's first scheduled tick is its init), and `if(c++&1) return` skips every
 * other one after that.
 */
export const SWEEP_TICKS = SWEEP_STEPS * 2 - 1;

/**
 * `couleur = 8<<4`, which the original calls grey ("gris pour mort naturelle"). It is grey only in
 * intent: colour 8 draws from palette slots 240-247, `Canvas::change_level` copies those straight
 * out of each level's backdrop, and the backdrops put a ramp of their own there — purple on level
 * 1, blue on 3. The true grey ramp is colour 7's, at 248. So the wipe takes on the level's tint,
 * as the ghost piece does, and that is what the 1998 game shows too.
 */
export const DEAD_COLOR = 8;

/** Steps taken `ticks` ticks after the game ended. */
export function sweepSteps(ticks: number): number {
  return ticks <= 0 ? 0 : Math.min(SWEEP_STEPS, (ticks + 1) >> 1);
}

/**
 * The step on which the cell at absolute (`row`, `col`) turns grey. The original walks
 * `i = 11..21` down rows and `j = 4..8` across columns, touching `[i][j]`, `[42-i][j]`,
 * `[i][17-j]` and `[42-i][17-j]` each time — so the bottom row (31) goes with the hidden row 11,
 * a step ahead of the top visible one, and row 21 is reached from both ends at once.
 */
export function sweepOrder(row: number, col: number): number {
  const across = col <= 8 ? col - 4 : 17 - col - 4;
  const down = row <= 21 ? row - 11 : 42 - row - 11;
  return across * ROWS_PER_COLUMN + down;
}

/** Whether the cell at (`row`, `col`) is grey once `steps` steps have run. */
export function isSwept(row: number, col: number, steps: number): boolean {
  return sweepOrder(row, col) < steps;
}

/** A board the sweep can follow — a `Canvas`, without depending on the engine's whole type. */
export interface SweepSource {
  readonly dead: boolean;
}

/**
 * The wipe's clock. One per `Screen`, followed by whichever host is drawing, the way
 * `TextScrollers` is.
 *
 * Driven by wall time, not by the simulation's ticks, because there are none: the host stops
 * running a game once it is over. That is what makes it the host's to drive, and why a board
 * nobody followed while it died is drawn already grey — whatever happened to it happened off
 * screen, and replaying it on the way back would show the death twice.
 */
export class DeathSweep {
  private source: SweepSource | null = null;
  private ms = 0;
  private steps = 0;
  /** Set on the first follow that sees the board dead, so that frame's time is not counted. */
  private running = false;

  /**
   * Run the wipe on by `elapsedMs`. Returns how many columns it finished in doing so, which is
   * how many times to play the sample (source/player.cc:1253-1254).
   */
  follow(source: SweepSource, elapsedMs: number): number {
    if (source !== this.source) {
      this.jumpTo(source);
      return 0;
    }
    if (!source.dead) {
      this.reset();
      return 0;
    }
    if (!this.running) {
      // It died somewhere in the ticks just run. The original's first step is the tick after.
      this.running = true;
      return 0;
    }
    if (this.steps === SWEEP_STEPS) return 0;

    this.ms += elapsedMs;
    const before = this.steps;
    this.steps = sweepSteps(Math.floor(this.ms / TICK_MS));
    return columnsDone(this.steps) - columnsDone(before);
  }

  /**
   * Take up `source` as it stands, with nothing animated — for a board reached by a jump
   * rather than by playing, such as a replay being scrubbed.
   */
  jumpTo(source: SweepSource): void {
    this.source = source;
    this.ms = 0;
    this.running = source.dead;
    this.steps = source.dead ? SWEEP_STEPS : 0;
  }

  /** How many steps to draw `board` with. */
  stepsFor(board: SweepSource): number {
    if (!board.dead) return 0;
    return board === this.source ? this.steps : SWEEP_STEPS;
  }

  /** Nothing left to animate on `board` — alive, or already all grey. */
  settled(board: SweepSource): boolean {
    return this.stepsFor(board) === (board.dead ? SWEEP_STEPS : 0);
  }

  private reset(): void {
    this.ms = 0;
    this.steps = 0;
    this.running = false;
  }
}

function columnsDone(steps: number): number {
  return Math.floor(steps / ROWS_PER_COLUMN);
}
