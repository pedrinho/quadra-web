/*
 * Port of source/bloc.cc / bloc.h in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { PIECES } from './pieces.js';

/**
 * A falling piece.
 *
 * `bx`/`by` are the authoritative grid position of the piece's 4x4 box. `x`/`y` are a
 * smooth position in 1/16-px fixed point used for drawing and, for `y`, for gravity — one
 * cell of travel is 18*16 = 288 units.
 *
 * The horizontal smooth position is purely cosmetic: `bx` moves instantly and `x` chases
 * it at `sideSpeed`. Vertical is the opposite — `y` accumulates gravity and `by` is derived
 * from it.
 */
export class Bloc {
  /** Piece type, 0..6, indexing PIECES. */
  readonly quel: number;
  /** Colour index; defaults to the piece type. 8 is grey, used for the ghost piece. */
  readonly col: number;
  x = 0;
  y = 0;
  rot = 0;
  bx: number;
  by: number;

  constructor(quel: number, col: number, bx: number, by: number) {
    this.quel = quel;
    this.col = col === -1 ? quel : col;
    this.bx = bx;
    this.by = by;
    this.calcXY();
    // Start one cell higher than the grid position so the piece visibly slides in from
    // above rather than popping into place (source/bloc.cc:37).
    this.y -= 17 << 4;
  }

  /** `Bloc::calc_xy` — derive the smooth position from the grid position. */
  calcXY(): void {
    this.x = ((this.bx - 4) * 18) << 4;
    this.y = ((this.by - 12) * 18) << 4;
  }

  /** The 4x4 exposed-edge grid for the current rotation. */
  grid(): readonly number[][] {
    return PIECES[this.quel]![this.rot]!;
  }

  clone(): Bloc {
    const b = new Bloc(this.quel, this.col, this.bx, this.by);
    b.x = this.x;
    b.y = this.y;
    b.rot = this.rot;
    return b;
  }
}
