/*
 * Port of Quadra's connectivity-gravity cascade.
 * Player_check_line / Player_check_link — source/player.cc:527-845.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import {
  Board,
  COLS,
  ROWS,
  PLAY_BOTTOM,
  PLAY_LEFT,
  PLAY_RIGHT,
  PLAY_TOP,
  idx,
} from './board.js';
import { EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP } from './pieces.js';

/**
 * `Player_check_link::fill_bloc` — source/player.cc:836-845, recursion replaced by an
 * explicit stack.
 *
 * Marks a whole welded group as supported. Spread happens across CLEAR edge bits only: a
 * clear bit means this cell is welded to that neighbour, so the neighbour is part of the
 * same rigid body and is supported too.
 *
 * Deliberately does NOT test occupancy, matching the original. That is safe because the
 * edge masks maintain the invariant "a clear edge implies an occupied, welded neighbour";
 * see assertWeldInvariant(), which is what actually guards this.
 */
function fillBloc(board: Board, startCol: number, startRow: number): void {
  const stack: number[] = [idx(startRow, startCol)];
  const { tmp, block } = board;

  while (stack.length) {
    const at = stack.pop()!;
    if (tmp[at]) continue;
    tmp[at] = 1;

    const mask = block[at]! & 0x0f;
    if (!(mask & EDGE_BOTTOM) && !tmp[at + COLS]) stack.push(at + COLS);
    if (!(mask & EDGE_LEFT) && !tmp[at - 1]) stack.push(at - 1);
    if (!(mask & EDGE_RIGHT) && !tmp[at + 1]) stack.push(at + 1);
    if (!(mask & EDGE_TOP) && !tmp[at - COLS]) stack.push(at - COLS);
  }
}

/**
 * Cascade phase 0 — `Player_check_link::step` anim==0, source/player.cc:770-784.
 *
 * Repeats to a fixpoint: any cell with an exposed bottom that is resting on an
 * already-supported cell drags its entire welded group into the supported set. The floor
 * row and the side walls are pre-seeded as supported by Board.initBlock().
 *
 * After this returns, `board.tmp` marks every cell that will NOT fall.
 */
export function computeSupport(board: Board): void {
  const { tmp, block } = board;
  let changed = true;
  while (changed) {
    changed = false;
    // Bottom-up, so support propagates upward in as few passes as possible.
    for (let j = PLAY_BOTTOM - 1; j >= 0; j--) {
      for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
        const at = idx(j, i);
        if (block[at]! & EDGE_BOTTOM && !tmp[at] && tmp[at + COLS]) {
          fillBloc(board, i, j);
          changed = true;
        }
      }
    }
  }
}

/**
 * Cascade phase 1 — `Player_check_link::step` anim==1, source/player.cc:786-812.
 *
 * Moves every occupied-but-unsupported cell down exactly one row. Returns true if anything
 * moved, which is what tells the caller to keep cascading.
 *
 * Iterates bottom-up so a cell is always written into a row that has already been vacated.
 */
export function dropUnsupported(board: Board): boolean {
  const { occupied, block, tmp, blinded, bflash, moved } = board;
  let anyMoved = false;

  const movedThisPass = new Uint8Array(occupied.length);

  for (let j = PLAY_BOTTOM - 1; j >= 0; j--) {
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
      const at = idx(j, i);
      if (!occupied[at] || tmp[at]) continue;
      anyMoved = true;
      const below = at + COLS;
      block[below] = block[at]!;
      occupied[below] = occupied[at]!;
      blinded[below] = blinded[at]!;
      bflash[below] = bflash[at]!;
      movedThisPass[below] = 1;
      block[at] = 0;
      occupied[at] = 0;
      blinded[at] = 0;
      bflash[at] = 0;
    }
  }

  // Overwrite Canvas::moved a row at a time, but only for rows that saw movement — the
  // original preserves the previous contents of untouched rows (source/player.cc:808-818).
  if (anyMoved) {
    for (let j = 0; j < ROWS; j++) {
      let movementInLine = false;
      for (let i = 0; i < COLS; i++) if (movedThisPass[idx(j, i)]) movementInLine = true;
      if (movementInLine)
        for (let i = 0; i < COLS; i++) moved[idx(j, i)] = movedThisPass[idx(j, i)]!;
    }
  }

  return anyMoved;
}

/**
 * Run the support/fall loop to completion, returning how many rows the stack fell.
 *
 * The original animates this one row per two simulation frames (phases alternate); this
 * runs it to a fixpoint for headless use and tests. The frame-accurate driver in player.ts
 * steps the phases individually.
 */
export function settle(board: Board): number {
  let rows = 0;
  for (;;) {
    board.clearTmp();
    computeSupport(board);
    if (!dropUnsupported(board)) return rows;
    rows++;
  }
}

export interface ClearedLines {
  /** Number of full rows removed. */
  count: number;
  /** Row indices that were removed, top to bottom, in board coordinates. */
  rows: number[];
  /**
   * For each cleared row, which columns held cells that had moved this turn. This is what
   * shapes the holes in the garbage sent to opponents — the holes mirror the rubble that
   * moved in the attacker's own cascade.
   */
  holePos: boolean[][];
}

/**
 * `Player_check_line::check_nb_line` — source/player.cc:554-583.
 *
 * Erases every full row and OPENS the exposed-edge bits of the cells directly above and
 * below it. That edge-opening is the mechanic: it severs the welds that ran through the
 * cleared row, splitting pieces into fragments that then fall independently.
 *
 * Note it does not shift anything down — compaction is entirely the job of the cascade.
 */
export function clearFullLines(board: Board): ClearedLines {
  const { occupied, block, blinded, bflash, moved } = board;
  const rows: number[] = [];
  const holePos: boolean[][] = [];

  for (let j = PLAY_TOP; j < PLAY_BOTTOM; j++) {
    let full = true;
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
      if (!occupied[idx(j, i)]) {
        full = false;
        break;
      }
    }
    if (!full) continue;

    rows.push(j);
    const holes: boolean[] = [];

    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
      const at = idx(j, i);
      const above = at - COLS;
      const below = at + COLS;

      // Expose the bottom of the cell above: it was welded through this row.
      if (occupied[above] && !(block[above]! & EDGE_BOTTOM)) block[above]! |= EDGE_BOTTOM;

      holes.push(moved[at] !== 0);

      block[at] = 0;
      occupied[at] = 0;
      blinded[at] = 0;
      bflash[at] = 0;

      // Expose the top of the cell below.
      if (occupied[below] && !(block[below]! & EDGE_TOP)) block[below]! |= EDGE_TOP;
    }
    holePos.push(holes);
  }

  return { count: rows.length, rows, holePos };
}

export interface CascadeResult {
  /** Total rows cleared across every iteration of this cascade. */
  depth: number;
  /** Number of cascade iterations — 1 for a plain clear, 2+ for a chain. Squared into the
   *  score by giveLine(). */
  complexity: number;
  /** The playfield ended up completely empty. */
  clean: boolean;
}

/**
 * The full clear/fall/clear loop — `Player_check_line::step` calling itself through
 * `Player_flash_lines` → `Player_check_link`, source/player.cc:527-552.
 *
 * In the original this is spread across frames by the module stack (16 frames of line
 * flash, then one row of falling per two frames). This runs it to completion, which is what
 * the headless engine and the tests want; the animated version drives the same primitives
 * a phase at a time.
 */
export function resolve(board: Board): CascadeResult {
  board.depth = 0;
  board.complexity = 0;
  board.sendForClean = false;

  for (;;) {
    const cleared = clearFullLines(board);
    if (cleared.count === 0) break;
    board.depth += cleared.count;
    board.complexity++;
    // check_clean runs immediately after the erase, before anything falls.
    if (board.isClean()) board.sendForClean = true;
    settle(board);
  }

  return { depth: board.depth, complexity: board.complexity, clean: board.sendForClean };
}

/**
 * Invariant that the whole mechanic rests on: a cell's edge bit is CLEAR exactly where it
 * is welded to an occupied neighbour. If this is ever violated, fillBloc will leak support
 * across empty space and the cascade silently stops working.
 *
 * Cheap enough to call from tests after every operation; not called in the hot path.
 */
export function assertWeldInvariant(board: Board): void {
  for (let j = 0; j < PLAY_BOTTOM; j++) {
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
      if (!board.isOccupied(j, i)) continue;
      const m = board.edges(j, i);
      const check = (bit: number, r: number, c: number, name: string) => {
        const welded = !(m & bit);
        if (welded && !board.isOccupied(r, c))
          throw new Error(
            `weld invariant violated at (${j},${i}) mask=${m}: ${name} edge is clear ` +
              `but (${r},${c}) is empty`,
          );
      };
      check(EDGE_LEFT, j, i - 1, 'left');
      check(EDGE_TOP, j - 1, i, 'top');
      check(EDGE_RIGHT, j, i + 1, 'right');
      check(EDGE_BOTTOM, j + 1, i, 'bottom');
    }
  }
}
