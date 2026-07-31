/*
 * Block rendering — port of raw_draw_bloc / raw_draw_bloc_corner / raw_small_draw_bloc
 * from source/quadra.cc:82-197.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Blocks are not sprites — they are drawn procedurally from the exposed-edge mask, with a
 * 3px bevel on every exposed side. That is why the bevels double as gameplay information:
 * an edge is drawn exactly where a cell is NOT welded to its neighbour, so the outline of
 * a bevelled region is the outline of a rigid body.
 */

import type { Framebuffer } from './framebuffer.js';
import { EDGE_LEFT, EDGE_TOP, EDGE_RIGHT, EDGE_BOTTOM } from '../engine/pieces.js';

export const CELL = 18;
export const SMALL_CELL = 6;

/**
 * Palette base for a colour index. `Color::Color` — source/color.cc:25-32.
 * Each colour owns 8 consecutive palette slots starting at 184, and 7 and 8 are swapped.
 */
export function colorBase(q: number): number {
  const adjusted = q === 8 ? 7 : q === 7 ? 8 : q;
  return adjusted * 8 + 184;
}

/** `Color::shade(i)` — palette index of shade i (0..7) of colour q. */
export function shade(q: number, i: number): number {
  return colorBase(q) + i;
}

/**
 * `raw_draw_bloc` — an 18x18 cell with 3px bevels on each exposed edge.
 * Light shades (7,6,5) on the left and top, dark (1,2,3) on the right and bottom, fill
 * with shade 4.
 */
export function drawBloc(fb: Framebuffer, x: number, y: number, side: number, col: number): void {
  let rx = 0;
  let ry = 0;
  let rw = CELL;
  let rh = CELL;
  let tx: number;
  let tl: number;

  if (side & EDGE_LEFT) {
    fb.vline(x, y, 18, shade(col, 7));
    fb.vline(x + 1, y, 18, shade(col, 6));
    fb.vline(x + 2, y, 18, shade(col, 5));
    rx = 3;
    rw -= 3;
  }
  if (side & EDGE_TOP) {
    fb.hline(y, x, 18, shade(col, 7));
    tx = side & EDGE_LEFT ? x + 1 : x;
    fb.hline(y + 1, tx, x - tx + 18, shade(col, 6));
    tx = side & EDGE_LEFT ? x + 2 : x;
    fb.hline(y + 2, tx, x - tx + 18, shade(col, 5));
    ry = 3;
    rh -= 3;
  }
  if (side & EDGE_RIGHT) {
    fb.vline(x + 17, y, 18, shade(col, 1));
    tx = side & EDGE_TOP ? y + 1 : y;
    fb.vline(x + 16, tx, y - tx + 18, shade(col, 2));
    tx = side & EDGE_TOP ? y + 2 : y;
    fb.vline(x + 15, tx, y - tx + 18, shade(col, 3));
    rw -= 3;
  }
  if (side & EDGE_BOTTOM) {
    fb.hline(y + 17, x, 18, shade(col, 1));
    tx = side & EDGE_LEFT ? x + 1 : x;
    tl = x - tx + 18;
    if (side & EDGE_RIGHT) tl--;
    fb.hline(y + 16, tx, tl, shade(col, 2));
    tx = side & EDGE_LEFT ? x + 2 : x;
    tl = x - tx + 18;
    if (side & EDGE_RIGHT) tl -= 2;
    fb.hline(y + 15, tx, tl, shade(col, 3));
    rh -= 3;
  }

  const main = shade(col, 4);
  for (let i = 0; i < rh; i++) fb.hline(y + ry + i, x + rx, rw, main);
}

/**
 * `raw_draw_bloc_corner` — as above plus the six pixels that join two bevels at a corner,
 * drawn only where both this cell and the relevant neighbours agree there is an edge.
 *
 * `to` holds the edge masks of the neighbours: [left, up, right, down].
 */
export function drawBlocCorner(
  fb: Framebuffer,
  x: number,
  y: number,
  side: number,
  col: number,
  to: readonly number[],
): void {
  drawBloc(fb, x, y, side, col);

  if (!(side & EDGE_LEFT) && !(side & EDGE_TOP) && to[0]! & EDGE_TOP && to[1]! & EDGE_LEFT) {
    fb.putPel(x, y, shade(col, 7));
    fb.putPel(x + 1, y, shade(col, 6));
    fb.putPel(x, y + 1, shade(col, 6));
    fb.putPel(x + 2, y, shade(col, 5));
    fb.putPel(x + 1, y + 1, shade(col, 5));
    fb.putPel(x, y + 2, shade(col, 5));
  }
  if (!(side & EDGE_RIGHT) && !(side & EDGE_TOP) && to[2]! & EDGE_TOP && to[1]! & EDGE_RIGHT) {
    fb.putPel(x + 17, y, shade(col, 3));
    fb.putPel(x + 16, y, shade(col, 3));
    fb.putPel(x + 17, y + 1, shade(col, 4));
    fb.putPel(x + 15, y, shade(col, 3));
    fb.putPel(x + 16, y + 1, shade(col, 4));
    fb.putPel(x + 17, y + 2, shade(col, 5));
  }
  if (!(side & EDGE_LEFT) && !(side & EDGE_BOTTOM) && to[0]! & EDGE_BOTTOM && to[3]! & EDGE_LEFT) {
    fb.putPel(x, y + 17, shade(col, 7));
    fb.putPel(x + 1, y + 17, shade(col, 6));
    fb.putPel(x, y + 16, shade(col, 6));
    fb.putPel(x + 2, y + 17, shade(col, 5));
    fb.putPel(x + 1, y + 16, shade(col, 5));
    fb.putPel(x, y + 15, shade(col, 5));
  }
  if (!(side & EDGE_RIGHT) && !(side & EDGE_BOTTOM) && to[2]! & EDGE_BOTTOM && to[3]! & EDGE_RIGHT) {
    fb.putPel(x + 17, y + 17, shade(col, 1));
    fb.putPel(x + 16, y + 17, shade(col, 2));
    fb.putPel(x + 17, y + 16, shade(col, 2));
    fb.putPel(x + 15, y + 17, shade(col, 3));
    fb.putPel(x + 16, y + 16, shade(col, 3));
    fb.putPel(x + 17, y + 15, shade(col, 3));
  }
}

/** `raw_small_draw_bloc` — the 6x6 spectator-view cell, 1px bevels. */
export function drawBlocSmall(
  fb: Framebuffer,
  x: number,
  y: number,
  side: number,
  col: number,
): void {
  let rx = 0;
  let ry = 0;
  let rw = SMALL_CELL;
  let rh = SMALL_CELL;

  if (side & EDGE_LEFT) {
    fb.vline(x, y, 6, shade(col, 7));
    rx++;
    rw--;
  }
  if (side & EDGE_TOP) {
    fb.hline(y, x, 6, shade(col, 7));
    ry++;
    rh--;
  }
  if (side & EDGE_RIGHT) {
    fb.vline(x + 5, y, 6, shade(col, 1));
    rw--;
  }
  if (side & EDGE_BOTTOM) {
    fb.hline(y + 5, x, 6, shade(col, 1));
    rh--;
  }
  for (let i = 0; i < rh; i++) fb.hline(y + ry + i, x + rx, rw, shade(col, 4));
}
