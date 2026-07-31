/*
 * Port of the piece tables from source/bloc.cc:88-115 in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

/** Exposed-edge bits. A bit is SET where the cell has an exposed edge, CLEAR where it is
 *  welded to the neighbour in that direction. */
export const EDGE_LEFT = 1;
export const EDGE_TOP = 2;
export const EDGE_RIGHT = 4;
export const EDGE_BOTTOM = 8;
/** All four edges exposed — an isolated single cell. */
export const EDGE_ALL = 15;

/**
 * `Bloc::bloc[7][4][4][4]` — [piece][rotation][row][col].
 *
 * These are NOT occupancy flags. Each non-zero entry *is* the cell's exposed-edge mask, so
 * a tetromino is born with only its outer boundary marked and its four cells welded
 * together. That welding is what makes groups fall as rigid bodies after a line clear
 * severs them. Zero means "no cell here".
 *
 * Pieces 0 (O), 1 (S), 2 (Z) and 5 (I) have only two distinct orientations; the original
 * duplicates them into rotation slots 2 and 3 so `rot` can stay a plain `& 3`.
 */
export const PIECES: readonly number[][][][] = [
  // 0 — O
  [
    [[0, 0, 0, 0], [0, 3, 6, 0], [0, 9, 12, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [0, 3, 6, 0], [0, 9, 12, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [0, 3, 6, 0], [0, 9, 12, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [0, 3, 6, 0], [0, 9, 12, 0], [0, 0, 0, 0]],
  ],
  // 1 — S
  [
    [[0, 0, 0, 0], [0, 3, 14, 0], [11, 12, 0, 0], [0, 0, 0, 0]],
    [[7, 0, 0, 0], [9, 6, 0, 0], [0, 13, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [0, 3, 14, 0], [11, 12, 0, 0], [0, 0, 0, 0]],
    [[7, 0, 0, 0], [9, 6, 0, 0], [0, 13, 0, 0], [0, 0, 0, 0]],
  ],
  // 2 — Z
  [
    [[0, 0, 0, 0], [11, 6, 0, 0], [0, 9, 14, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [3, 12, 0, 0], [13, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [11, 6, 0, 0], [0, 9, 14, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [3, 12, 0, 0], [13, 0, 0, 0], [0, 0, 0, 0]],
  ],
  // 3 — J
  [
    [[0, 0, 0, 0], [3, 10, 14, 0], [13, 0, 0, 0], [0, 0, 0, 0]],
    [[11, 6, 0, 0], [0, 5, 0, 0], [0, 13, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 7, 0], [11, 10, 12, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [0, 5, 0, 0], [0, 9, 14, 0], [0, 0, 0, 0]],
  ],
  // 4 — L
  [
    [[0, 0, 0, 0], [11, 10, 6, 0], [0, 0, 13, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [0, 5, 0, 0], [11, 12, 0, 0], [0, 0, 0, 0]],
    [[7, 0, 0, 0], [9, 10, 14, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 3, 14, 0], [0, 5, 0, 0], [0, 13, 0, 0], [0, 0, 0, 0]],
  ],
  // 5 — I
  [
    [[0, 0, 0, 0], [11, 10, 10, 14], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [0, 5, 0, 0], [0, 5, 0, 0], [0, 13, 0, 0]],
    [[0, 0, 0, 0], [11, 10, 10, 14], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [0, 5, 0, 0], [0, 5, 0, 0], [0, 13, 0, 0]],
  ],
  // 6 — T
  [
    [[0, 0, 0, 0], [11, 2, 14, 0], [0, 13, 0, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [11, 4, 0, 0], [0, 13, 0, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [11, 8, 14, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 7, 0, 0], [0, 1, 14, 0], [0, 13, 0, 0], [0, 0, 0, 0]],
  ],
];

export const PIECE_COUNT = 7;
export const ROTATIONS = 4;

/** Human-readable names, derived from the shapes. The original refers to pieces only by
 *  index (`quel`); these are for tests and debug output. */
export const PIECE_NAMES = ['O', 'S', 'Z', 'J', 'L', 'I', 'T'] as const;
