import { describe, it, expect } from 'vitest';
import {
  PIECES,
  PIECE_NAMES,
  PIECE_COUNT,
  ROTATIONS,
  EDGE_LEFT,
  EDGE_TOP,
  EDGE_RIGHT,
  EDGE_BOTTOM,
} from '../src/engine/pieces.js';

/**
 * The edge masks are hand-transcribed from C++, and a single wrong digit would silently
 * break the welding rule — a piece would fall apart, or two pieces would fuse. Rather than
 * trust the transcription, assert the invariant that defines the encoding:
 *
 *   an edge bit is CLEAR exactly where the piece has another cell in that direction.
 *
 * Any typo violates this, because the masks are wildly over-determined by the shape.
 */
describe('piece tables — edge masks agree with the shapes', () => {
  for (let p = 0; p < PIECE_COUNT; p++) {
    for (let rot = 0; rot < ROTATIONS; rot++) {
      it(`${PIECE_NAMES[p]} rot ${rot}`, () => {
        const g = PIECES[p]![rot]!;
        const occupied = (r: number, c: number) =>
          r >= 0 && r < 4 && c >= 0 && c < 4 && g[r]![c]! !== 0;

        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const mask = g[r]![c]!;
            if (mask === 0) continue;
            const where = `${PIECE_NAMES[p]} rot${rot} cell(${r},${c}) mask=${mask}`;
            expect(!!(mask & EDGE_LEFT), `${where} left`).toBe(!occupied(r, c - 1));
            expect(!!(mask & EDGE_TOP), `${where} top`).toBe(!occupied(r - 1, c));
            expect(!!(mask & EDGE_RIGHT), `${where} right`).toBe(!occupied(r, c + 1));
            expect(!!(mask & EDGE_BOTTOM), `${where} bottom`).toBe(!occupied(r + 1, c));
          }
        }
      });
    }
  }

  it('every piece has exactly 4 cells in every rotation', () => {
    for (let p = 0; p < PIECE_COUNT; p++) {
      for (let rot = 0; rot < ROTATIONS; rot++) {
        const count = PIECES[p]![rot]!.flat().filter((v) => v !== 0).length;
        expect(count, `${PIECE_NAMES[p]} rot ${rot}`).toBe(4);
      }
    }
  });

  it('every piece is a single connected group (all four cells welded)', () => {
    for (let p = 0; p < PIECE_COUNT; p++) {
      for (let rot = 0; rot < ROTATIONS; rot++) {
        const g = PIECES[p]![rot]!;
        const cells: [number, number][] = [];
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 4; c++) if (g[r]![c]! !== 0) cells.push([r, c]);

        // Flood fill across CLEAR edge bits, exactly as fillBloc does.
        const seen = new Set<string>();
        const stack = [cells[0]!];
        while (stack.length) {
          const [r, c] = stack.pop()!;
          const key = `${r},${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const m = g[r]![c]!;
          if (!(m & EDGE_BOTTOM)) stack.push([r + 1, c]);
          if (!(m & EDGE_TOP)) stack.push([r - 1, c]);
          if (!(m & EDGE_LEFT)) stack.push([r, c - 1]);
          if (!(m & EDGE_RIGHT)) stack.push([r, c + 1]);
        }
        expect(seen.size, `${PIECE_NAMES[p]} rot ${rot}`).toBe(4);
      }
    }
  });

  it('O, S, Z and I have only two distinct orientations', () => {
    for (const p of [0, 1, 2, 5]) {
      expect(JSON.stringify(PIECES[p]![0]), `piece ${p}`).toBe(JSON.stringify(PIECES[p]![2]));
      expect(JSON.stringify(PIECES[p]![1]), `piece ${p}`).toBe(JSON.stringify(PIECES[p]![3]));
    }
  });
});
