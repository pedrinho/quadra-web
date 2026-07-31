/*
 * Draws a playfield, the falling piece and the next-piece previews.
 * Layout follows Pane_startgame::create_zone — source/pane.cc:1859-1895.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import type { Framebuffer } from './framebuffer.js';
import type { QImage } from './qimg.js';
import { CELL, SMALL_CELL, drawBloc, drawBlocCorner, drawBlocSmall } from './blocks.js';
import type { Canvas } from '../engine/canvas.js';
import type { Bloc } from '../engine/bloc.js';
import { PLAY_BOTTOM, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, idx } from '../engine/board.js';

/* The original runs three 214px panes side by side; single-player puts the board in the
 * middle one. These coordinates place the playfield where the background art expects it. */
export const PANE_WIDTH = 214;
export const BOARD_X = PANE_WIDTH + 9;
export const BOARD_Y = 37;
export const BOARD_W = (PLAY_RIGHT - PLAY_LEFT) * CELL; // 180
export const BOARD_H = (PLAY_BOTTOM - PLAY_TOP) * CELL; // 360

/* Preview and garbage-column positions, relative to the board, from Zone_canvas's
 * constructor (source/zone.cc:75-93). The two nearest previews are drawn at the small
 * 6px cell size, the third at full size. */
export const NEXT1 = { x: BOARD_X + 5, y: 2 };
export const NEXT2 = { x: BOARD_X + 32, y: 8 };
export const NEXT3 = { x: BOARD_X + 60, y: 0 };
export const BONUS_X = BOARD_X + 182;

/** Restore a region from the background image — the original's erase step. */
function eraseRegion(
  fb: Framebuffer,
  bg: QImage,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  fb.putImageRegion(bg.indices, bg.width, x, y, w, h, x, y);
}

/** Draw the settled cells of a board. */
export function drawBoard(fb: Framebuffer, bg: QImage, canvas: Canvas): void {
  eraseRegion(fb, bg, BOARD_X, BOARD_Y, BOARD_W, BOARD_H);

  for (let j = PLAY_TOP; j < PLAY_BOTTOM; j++) {
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
      if (!canvas.occupied[idx(j, i)]) continue;
      const cell = canvas.block[idx(j, i)]!;
      const side = cell & 15;
      const col = cell >> 4;
      // Neighbour masks drive the corner joins, so two welded cells read as one shape.
      const to = [
        canvas.block[idx(j, i - 1)]!,
        canvas.block[idx(j - 1, i)]!,
        canvas.block[idx(j, i + 1)]!,
        canvas.block[idx(j + 1, i)]!,
      ];
      drawBlocCorner(
        fb,
        BOARD_X + (i - PLAY_LEFT) * CELL,
        BOARD_Y + (j - PLAY_TOP) * CELL,
        side,
        col,
        to,
      );
    }
  }
}

/**
 * Draw the falling piece at its smooth position.
 *
 * `x`/`y` are 1/16-px fixed point, so the piece slides between cells rather than snapping.
 * Clipped to the playfield so the spawn buffer above the board stays hidden.
 */
export function drawFallingPiece(fb: Framebuffer, bloc: Bloc, ghost = false): void {
  const grid = bloc.grid();
  const px = BOARD_X + (bloc.x >> 4);
  const py = BOARD_Y + (bloc.y >> 4);
  const col = ghost ? 8 : bloc.col;

  // Clip to the playfield: a freshly spawned piece starts a cell above the top and slides
  // in, so without this it would draw over the header strip.
  fb.clipped(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, () => {
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const t = grid[j]![i]!;
        if (t) drawBloc(fb, px + i * CELL, py + j * CELL, t, col);
      }
    }
  });
}

/**
 * Draw a preview piece. `small` uses the 6px cell size, as the two nearer previews do.
 *
 * A preview zone is four cells wide but only **two** tall (`Zone_next`, source/zone.h:98),
 * and the piece is drawn one cell *above* the zone (source/zone.cc:41-44, :57-61). That
 * looks odd until you notice every piece occupies grid rows 1 and 2 at rotation 0, so the
 * offset lands them exactly inside the two-cell zone.
 *
 * Getting either half of that wrong matters: the full-size third preview sits at y=0, so a
 * four-cell-tall erase reaches 35px past BOARD_Y and wipes the piece descending into view.
 */
export function drawPreview(
  fb: Framebuffer,
  bg: QImage,
  bloc: Bloc | null,
  x: number,
  y: number,
  small = false,
): void {
  const size = small ? SMALL_CELL : CELL;
  eraseRegion(fb, bg, x, y, size * 4, size * 2);
  if (!bloc) return;
  const grid = bloc.grid();
  const top = y - size;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const t = grid[j]![i]!;
      if (!t) continue;
      if (small) drawBlocSmall(fb, x + i * size, top + j * size, t, bloc.col);
      else drawBloc(fb, x + i * size, top + j * size, t, bloc.col);
    }
}

/** The queued-garbage column to the right of the board (Zone_bonus, source/zone.cc:131-166). */
export function drawBonusColumn(fb: Framebuffer, bg: QImage, canvas: Canvas): void {
  const x = BONUS_X;
  eraseRegion(fb, bg, x, BOARD_Y, CELL, BOARD_H);
  for (let i = 0; i < canvas.bon.length && i < 20; i++) {
    drawBloc(fb, x, BOARD_Y + (19 - i) * CELL, 15, canvas.bon[i]!.color);
  }
}
