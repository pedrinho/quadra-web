/*
 * Board dump interchange with the original C++ game.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The C++ side is dump_board_for_port() in source/player.cc, enabled with QUADRA_DUMP=1.
 * Each cell is the raw block[] byte in hex — high nibble colour, low nibble exposed-edge
 * mask — or "--" when empty.
 *
 * The edge mask is the point. A screenshot shows colours but not which cells are welded to
 * which, and welding is what decides how a cascade behaves.
 */

import { Board, PLAY_HEIGHT, PLAY_LEFT, PLAY_TOP, PLAY_RIGHT, idx } from './board.js';

export const DUMP_START = '=== QUADRA_BOARD_DUMP ===';
export const DUMP_END = '=== END QUADRA_BOARD_DUMP ===';

/** Serialise a board in the same format the patched C++ emits. */
export function formatDump(board: Board): string {
  const lines = [DUMP_START];
  for (let j = PLAY_TOP; j < PLAY_TOP + PLAY_HEIGHT; j++) {
    let line = '  ';
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
      line += board.isOccupied(j, i)
        ? board.block[idx(j, i)]!.toString(16).padStart(2, '0') + ' '
        : '-- ';
    }
    lines.push(line);
  }
  lines.push(DUMP_END);
  return lines.join('\n');
}

/** Apply a parsed set of rows onto a board. Rows are the 20 visible playfield rows. */
export function applyDumpRows(board: Board, rows: string[]): void {
  if (rows.length !== PLAY_HEIGHT)
    throw new Error(`expected ${PLAY_HEIGHT} rows in dump, got ${rows.length}`);

  rows.forEach((line, r) => {
    const cells = line.trim().split(/\s+/).filter(Boolean);
    if (cells.length !== PLAY_RIGHT - PLAY_LEFT)
      throw new Error(`dump row ${r}: expected 10 cells, got ${cells.length}`);
    cells.forEach((cell, i) => {
      const at = idx(PLAY_TOP + r, PLAY_LEFT + i);
      if (cell === '--') {
        board.block[at] = 0;
        board.occupied[at] = 0;
        return;
      }
      const byte = parseInt(cell, 16);
      if (Number.isNaN(byte)) throw new Error(`dump row ${r} col ${i}: bad cell "${cell}"`);
      board.block[at] = byte;
      board.occupied[at] = 1;
    });
  });
}

/**
 * Extract every dump in a log. The patched game emits one per settled move, so the last
 * entry is the final board state.
 */
export function parseDumps(text: string): string[][] {
  const dumps: string[][] = [];
  let rows: string[] | null = null;

  for (const line of text.split('\n')) {
    if (line.includes(DUMP_START)) {
      rows = [];
      continue;
    }
    if (line.includes(DUMP_END)) {
      if (rows) dumps.push(rows);
      rows = null;
      continue;
    }
    if (rows && line.trim()) rows.push(line);
  }
  return dumps;
}
