/*
 * A crude stacker, for tests that need a game with something in it.
 *
 * Not an opponent and not a benchmark — it walks each piece to the deepest column and drops
 * it, which is enough to fill rows, clear a few and set off a cascade before it buries itself.
 * The point is that it plays through `Game.input`, exactly like a person at a keyboard, so a
 * recording of it is a recording of real play rather than of the board being poked directly.
 *
 * The real CPU player belongs to the AI milestone and lives nowhere near here.
 */

import { PLAY_BOTTOM, PLAY_LEFT, PLAY_RIGHT } from '../src/engine/board.js';
import { Action } from '../src/engine/canvas.js';
import type { Game } from '../src/engine/game.js';

export class Autoplayer {
  private target = -1;
  private held: Action | null = null;
  private piece: unknown = null;

  constructor(private readonly game: Game) {}

  /** Call once per rendered frame, before stepping it. */
  frame(): void {
    const g = this.game;
    const bloc = g.canvas.bloc;
    if (!bloc) return;
    if (bloc !== this.piece) {
      this.piece = bloc;
      this.target = PLAY_LEFT + this.deepestColumn();
      g.input(Action.Drop, false);
    }
    const want =
      bloc.bx < this.target ? Action.Right : bloc.bx > this.target ? Action.Left : null;
    if (want !== this.held) {
      if (this.held !== null) g.input(this.held, false);
      if (want !== null) g.input(want, true);
      this.held = want;
    }
    if (want === null) g.input(Action.Drop, true);
  }

  private deepestColumn(): number {
    let best = 0;
    let bestDepth = -1;
    for (let col = PLAY_LEFT; col < PLAY_RIGHT; col++) {
      let row = 0;
      while (row < PLAY_BOTTOM && !this.game.canvas.isOccupied(row, col)) row++;
      if (row > bestDepth) {
        bestDepth = row;
        best = col - PLAY_LEFT;
      }
    }
    return best;
  }
}

/**
 * A seed this stacker gets a scoring game out of: three lines, a two-deep cascade and a
 * top-out at around frame 4550. Found by sweeping seeds — with no line clears a recording
 * proves nothing about the parts of the engine anyone cares about.
 */
export const SCORING_SEED = 1058;
