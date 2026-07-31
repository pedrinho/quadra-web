/*
 * Port of the board state from source/canvas.cc / canvas.h in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { PIECES, EDGE_LEFT, EDGE_TOP, EDGE_RIGHT, EDGE_BOTTOM } from './pieces.js';

/*
 * Geometry. The original bakes the walls and floor straight into the arrays so that
 * collision is a plain lookup with no bounds checks, and every ported offset assumes it.
 * Keep it — re-indexing to a bare 10x20 would mean touching every constant in the port.
 *
 *   columns 0..3   walls (permanently occupied)
 *   columns 4..13  playfield (10 wide)
 *   columns 14..17 walls
 *   rows    0..11  hidden spawn buffer
 *   rows    12..31 visible playfield (20 tall)
 *   rows    32..35 floor (permanently occupied)
 */
export const ROWS = 36;
export const COLS = 18;
export const PLAY_LEFT = 4;
export const PLAY_RIGHT = 14; // exclusive
export const PLAY_TOP = 12;
export const PLAY_BOTTOM = 32; // exclusive
export const PLAY_WIDTH = PLAY_RIGHT - PLAY_LEFT; // 10
export const PLAY_HEIGHT = PLAY_BOTTOM - PLAY_TOP; // 20

/** Pixels per cell in the original art. */
export const CELL_SIZE = 18;
/** One cell of vertical travel in 1/16-px fixed point: 18 * 16. */
export const CELL_FIXED = CELL_SIZE << 4;

export const idx = (row: number, col: number): number => row * COLS + col;

/**
 * The playfield: occupancy, per-cell exposed-edge masks, and the scratch arrays the
 * cascade uses.
 *
 * `block[]` holds the edge mask in the low nibble and the colour index in the high nibble,
 * exactly as the original packs it.
 */
export class Board {
  /** Solidity. Collision tests read only this. */
  readonly occupied = new Uint8Array(ROWS * COLS);
  /** Low nibble = exposed-edge mask, high nibble = colour. */
  readonly block = new Uint8Array(ROWS * COLS);
  /** Support marks for the cascade's flood fill. Seeded on the floor and walls. */
  readonly tmp = new Uint8Array(ROWS * COLS);
  /** Cells that moved or were placed during this move; feeds garbage hole positions. */
  readonly moved = new Uint8Array(ROWS * COLS);
  /** Per-cell blind countdown (blind attacks). */
  readonly blinded = new Uint8Array(ROWS * COLS);
  /** Blind-flash animation counter. */
  readonly bflash = new Uint8Array(ROWS * COLS);

  /** Lines cleared so far in the current move, accumulated across cascade iterations. */
  depth = 0;
  /** Cascade iteration count — the combo multiplier in giveLine(). */
  complexity = 0;
  /** Set when the playfield ends up completely empty after clears. */
  sendForClean = false;
  /** Current level; drives calcSpeed(). */
  level = 1;
  /** Gravity in 1/16-px per 100 Hz frame. One cell of travel is CELL_FIXED (288). */
  speed = 4;

  /** True where check_collide hit only the side walls — enables the wall kick. */
  collideSideOnly = false;

  constructor() {
    this.initBlock();
    this.calcSpeed();
  }

  /** `Canvas::init_block` — source/canvas.cc:307-338. */
  initBlock(): void {
    this.occupied.fill(0);
    this.block.fill(0);
    this.tmp.fill(0);
    this.blinded.fill(0);
    this.bflash.fill(0);
    this.moved.fill(0);

    // Floor.
    for (let y = PLAY_BOTTOM; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) this.occupied[idx(y, x)] = 1;

    // Side walls.
    for (let y = 0; y < PLAY_BOTTOM; y++)
      for (let x = 0; x < PLAY_LEFT; x++) {
        this.occupied[idx(y, x)] = 1;
        this.occupied[idx(y, x + PLAY_RIGHT)] = 1;
      }

    // Support seeds: the floor row and both walls count as supported, so the flood fill
    // has somewhere to start.
    for (let x = 0; x < COLS; x++) this.tmp[idx(PLAY_BOTTOM, x)] = 1;
    for (let y = 0; y < PLAY_BOTTOM; y++) {
      for (let x = 0; x < PLAY_LEFT; x++) this.tmp[idx(y, x)] = 1;
      for (let x = PLAY_RIGHT; x < COLS; x++) this.tmp[idx(y, x)] = 1;
    }
  }

  /**
   * `Canvas::clear_tmp` — source/canvas.cc:796-806. Resets support marks inside the
   * playfield only, leaving the floor and wall seeds intact. Runs between cascade
   * iterations so support never leaks across passes.
   */
  clearTmp(): void {
    for (let j = 0; j < PLAY_BOTTOM; j++)
      for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) this.tmp[idx(j, i)] = 0;
    this.moved.fill(0);
  }

  /** `Canvas::calc_speed` — source/canvas.cc:351-357. */
  calcSpeed(): void {
    this.speed = this.level <= 10 ? 4 + (this.level - 1) * 5 : 50 + (this.level - 10) * 3;
  }

  /**
   * `Canvas::check_collide` — source/canvas.cc:893-913.
   *
   * Note: the original indexes `blo->bloc[bloc->quel]`, i.e. it uses the *canvas's* current
   * piece type even when testing the shadow piece. That is unobservable because the shadow
   * always shares `quel`, so we take the type explicitly instead of reproducing the bug.
   *
   * Sets `collideSideOnly` when the only contact was with the side walls, which is what
   * lets a failed rotation retry one column toward the centre.
   */
  checkCollide(quel: number, px: number, py: number, rot: number): boolean {
    this.collideSideOnly = true;
    let hit = false;
    const grid = PIECES[quel]![rot]!;
    for (let j = 0; j < 4; j++) {
      const gridRow = grid[j]!;
      for (let i = 0; i < 4; i++) {
        if (!gridRow[i]) continue;
        if (this.occupied[idx(py + j, px + i)]) {
          if (px + i >= PLAY_LEFT && px + i < PLAY_RIGHT) this.collideSideOnly = false;
          hit = true;
        }
      }
    }
    if (!hit) this.collideSideOnly = false;
    return hit;
  }

  /** Exposed-edge mask of a cell (low nibble of block[]). */
  edges(row: number, col: number): number {
    return this.block[idx(row, col)]! & 0x0f;
  }

  /** Colour index of a cell (high nibble of block[]). */
  colorOf(row: number, col: number): number {
    return (this.block[idx(row, col)]! >> 4) & 0x0f;
  }

  isOccupied(row: number, col: number): boolean {
    return this.occupied[idx(row, col)] !== 0;
  }

  /** True when the visible playfield holds no cells — the clean-board bonus condition. */
  isClean(): boolean {
    for (let j = PLAY_TOP; j < PLAY_BOTTOM; j++)
      for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) if (this.occupied[idx(j, i)]) return false;
    return true;
  }

  /**
   * Set a playfield cell. Used by the piece stamper, the garbage builder and tests.
   * `edgeMask` follows the welding convention: a bit CLEAR means welded to that neighbour.
   */
  setCell(row: number, col: number, edgeMask: number, color: number): void {
    this.block[idx(row, col)] = (edgeMask & 0x0f) | ((color & 0x0f) << 4);
    this.occupied[idx(row, col)] = 1;
  }

  clearCell(row: number, col: number): void {
    this.block[idx(row, col)] = 0;
    this.occupied[idx(row, col)] = 0;
    this.blinded[idx(row, col)] = 0;
    this.bflash[idx(row, col)] = 0;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Test/debug notation
 * ---------------------------------------------------------------------------
 * Boards are described with one character per playfield cell: '.' for empty, any other
 * character for an occupied cell. Adjacent cells sharing a character are WELDED; different
 * characters are separate groups. That maps directly onto the edge-mask encoding and makes
 * cascade fixtures readable:
 *
 *     const b = boardFromAscii([
 *       '....AA....',
 *       '....AA....',
 *       'BBBBBBBBBB',
 *     ]);
 *
 * Rows are bottom-aligned to the floor, which is how you naturally write a stack.
 */

/** Distinct colour per group letter, so round-tripping preserves group identity visually. */
function colorForChar(ch: string): number {
  return (ch.charCodeAt(0) % 7) + 1;
}

export function boardFromAscii(rows: string[]): Board {
  const board = new Board();
  if (rows.length > PLAY_HEIGHT) throw new Error(`too many rows: ${rows.length} > ${PLAY_HEIGHT}`);
  for (const r of rows)
    if (r.length !== PLAY_WIDTH) throw new Error(`row "${r}" is not ${PLAY_WIDTH} wide`);

  const top = PLAY_BOTTOM - rows.length; // bottom-align against the floor
  const charAt = (r: number, c: number): string | null => {
    const row = rows[r - top];
    if (!row) return null;
    if (c < PLAY_LEFT || c >= PLAY_RIGHT) return null;
    const ch = row[c - PLAY_LEFT]!;
    return ch === '.' ? null : ch;
  };

  for (let r = top; r < PLAY_BOTTOM; r++) {
    for (let c = PLAY_LEFT; c < PLAY_RIGHT; c++) {
      const ch = charAt(r, c);
      if (ch === null) continue;
      // An edge is exposed unless the neighbour belongs to the same group.
      let mask = 0;
      if (charAt(r, c - 1) !== ch) mask |= EDGE_LEFT;
      if (charAt(r - 1, c) !== ch) mask |= EDGE_TOP;
      if (charAt(r, c + 1) !== ch) mask |= EDGE_RIGHT;
      if (charAt(r + 1, c) !== ch) mask |= EDGE_BOTTOM;
      board.setCell(r, c, mask, colorForChar(ch));
    }
  }
  return board;
}

/**
 * Render the playfield back to ASCII, labelling each welded group with its own letter.
 * Group letters are assigned in scan order, so output is stable and diffable.
 */
export function boardToAscii(board: Board, opts: { trim?: boolean } = {}): string[] {
  const { trim = true } = opts;
  const label = new Map<number, string>();
  let next = 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  for (let r = PLAY_TOP; r < PLAY_BOTTOM; r++) {
    for (let c = PLAY_LEFT; c < PLAY_RIGHT; c++) {
      if (!board.isOccupied(r, c) || label.has(idx(r, c))) continue;
      const ch = alphabet[next % alphabet.length]!;
      next++;
      // Flood fill across clear edge bits — the same rule fillBloc uses.
      const stack = [idx(r, c)];
      while (stack.length) {
        const at = stack.pop()!;
        if (label.has(at)) continue;
        label.set(at, ch);
        const rr = Math.floor(at / COLS);
        const cc = at % COLS;
        const m = board.edges(rr, cc);
        if (!(m & EDGE_BOTTOM) && board.isOccupied(rr + 1, cc)) stack.push(idx(rr + 1, cc));
        if (!(m & EDGE_TOP) && board.isOccupied(rr - 1, cc)) stack.push(idx(rr - 1, cc));
        if (!(m & EDGE_LEFT) && board.isOccupied(rr, cc - 1)) stack.push(idx(rr, cc - 1));
        if (!(m & EDGE_RIGHT) && board.isOccupied(rr, cc + 1)) stack.push(idx(rr, cc + 1));
      }
    }
  }

  const out: string[] = [];
  for (let r = PLAY_TOP; r < PLAY_BOTTOM; r++) {
    let line = '';
    for (let c = PLAY_LEFT; c < PLAY_RIGHT; c++)
      line += board.isOccupied(r, c) ? (label.get(idx(r, c)) ?? '?') : '.';
    out.push(line);
  }
  while (trim && out.length && out[0] === '.'.repeat(PLAY_WIDTH)) out.shift();
  return out;
}
