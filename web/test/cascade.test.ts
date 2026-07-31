import { describe, it, expect } from 'vitest';
import { boardFromAscii, boardToAscii } from '../src/engine/board.js';
import { settle, resolve, clearFullLines, assertWeldInvariant } from '../src/engine/cascade.js';

/*
 * Fixtures use one character per cell. Adjacent cells sharing a character are WELDED into
 * one rigid body; '.' is empty. Rows are bottom-aligned against the floor. Output is
 * relabelled in scan order, so the letters in `expect` describe grouping, not identity.
 */

describe('rigid-body gravity', () => {
  it('drops a welded group intact', () => {
    const b = boardFromAscii([
      'AA........',
      'AA........',
      '..........',
      '..........',
    ]);
    settle(b);
    assertWeldInvariant(b);
    expect(boardToAscii(b)).toEqual(['AA........', 'AA........']);
  });

  it('keeps an overhang welded and lands on the highest obstruction', () => {
    // The A group hangs over column 0; B blocks that column two rows down, so A can only
    // fall until its column-0 cell sits on top of B — the overhanging cell comes with it.
    const b = boardFromAscii([
      'AA........',
      '.A........',
      '..........',
      'B.........',
    ]);
    settle(b);
    assertWeldInvariant(b);
    expect(boardToAscii(b)).toEqual(['AA........', 'BA........']);
  });

  it('does not move a group that is already resting on the floor', () => {
    const b = boardFromAscii(['..AA......']);
    const before = boardToAscii(b);
    expect(settle(b)).toBe(0);
    expect(boardToAscii(b)).toEqual(before);
  });

  it('lets independent groups fall different distances', () => {
    const b = boardFromAscii([
      'A........B',
      '..........',
      '..........',
      '.....C....',
    ]);
    settle(b);
    assertWeldInvariant(b);
    expect(boardToAscii(b)).toEqual(['A....B...C']);
  });
});

describe('line clears sever welds', () => {
  it('splits a vertical group into two independently falling fragments', () => {
    // The A column runs through a row that is about to clear. Severing it must leave a
    // fragment above and a fragment below that are no longer welded together.
    const b = boardFromAscii([
      '..A.......',
      'BBABBBBBBB',
      '..A.......',
    ]);
    const cleared = clearFullLines(b);
    expect(cleared.count).toBe(1);

    settle(b);
    assertWeldInvariant(b);

    // Two separate single cells stacked — distinct letters prove the weld was cut.
    const out = boardToAscii(b);
    expect(out).toEqual(['..A.......', '..B.......']);
  });

  it('leaves a group welded when the clear passes outside it', () => {
    const b = boardFromAscii([
      'AA........',
      'AA........',
      'BBBBBBBBBB',
    ]);
    clearFullLines(b);
    settle(b);
    assertWeldInvariant(b);
    // A is untouched by the clear, so it stays one group and falls as a unit.
    expect(boardToAscii(b)).toEqual(['AA........', 'AA........']);
  });

  it('clears multiple full rows in one pass', () => {
    const b = boardFromAscii([
      'AAAAAAAAAA',
      'BBBBBBBBBB',
    ]);
    const cleared = clearFullLines(b);
    expect(cleared.count).toBe(2);
    expect(boardToAscii(b)).toEqual([]);
  });
});

describe('cascades', () => {
  it('chains when a severed fragment completes another line', () => {
    // Clearing row C drops the lone A into the gap in row D, completing it — which clears
    // again. That second clear is the whole point of the mechanic.
    const b = boardFromAscii([
      '.........A',
      'BBBBBBBBB.',
      'CCCCCCCCCC',
      'DDDDDDDDD.',
    ]);
    const result = resolve(b);
    assertWeldInvariant(b);

    expect(result.complexity).toBe(2); // two cascade iterations
    expect(result.depth).toBe(2); // two rows cleared in total
    // Both cleared rows are gone; the surviving B row has settled onto the floor.
    expect(boardToAscii(b)).toEqual(['AAAAAAAAA.']);
  });

  it('reports complexity 1 for a clear that triggers nothing further', () => {
    const b = boardFromAscii([
      'AA........',
      'BBBBBBBBBB',
    ]);
    const result = resolve(b);
    expect(result.complexity).toBe(1);
    expect(result.depth).toBe(1);
  });

  it('reports no cascade when nothing clears', () => {
    const b = boardFromAscii(['AA........']);
    const result = resolve(b);
    expect(result).toEqual({ depth: 0, complexity: 0, clean: false });
  });

  it('flags a clean board', () => {
    const b = boardFromAscii(['AAAAAAAAAA']);
    const result = resolve(b);
    expect(result.depth).toBe(1);
    expect(result.clean).toBe(true);
    expect(boardToAscii(b)).toEqual([]);
  });

  it('does not flag clean when rubble survives', () => {
    const b = boardFromAscii([
      'A.........',
      'BBBBBBBBBB',
    ]);
    const result = resolve(b);
    expect(result.clean).toBe(false);
  });
});

describe('garbage slabs', () => {
  it('drops a multi-row burst together rather than compacting row by row', () => {
    // Consecutive garbage lines from one attack share no top/bottom edges, so vertically
    // they are welded and fall as one body instead of settling independently.
    const b = boardFromAscii([
      'GGGGGGGGGG',
      'GGGGGGGGGG',
      '..........',
      '..........',
    ]);
    settle(b);
    assertWeldInvariant(b);
    expect(boardToAscii(b)).toEqual(['AAAAAAAAAA', 'AAAAAAAAAA']);
  });

  it('splits into two rigid bodies either side of the hole', () => {
    // The hole severs the row horizontally: player.cc:683-691 opens the right edge of the
    // cell left of the hole and the left edge of the cell right of it. So a punched
    // garbage slab is genuinely two independent bodies, not one.
    const b = boardFromAscii([
      'GGGG.GGGGG',
      'GGGG.GGGGG',
      '..........',
    ]);
    settle(b);
    assertWeldInvariant(b);
    expect(boardToAscii(b)).toEqual(['AAAA.BBBBB', 'AAAA.BBBBB']);
  });

  it('lets the two halves of a punched slab fall independently', () => {
    // Because they are separate bodies, a support under only one half holds only that half.
    const b = boardFromAscii([
      'GGGG.GGGGG',
      '..........',
      'X.........',
    ]);
    settle(b);
    assertWeldInvariant(b);
    expect(boardToAscii(b)).toEqual(['AAAA......', 'B....CCCCC']);
  });

  it('keeps the hole column aligned as the slab falls', () => {
    const b = boardFromAscii([
      'GG.GGGGGGG',
      'GG.GGGGGGG',
      '..........',
      '..........',
    ]);
    settle(b);
    const out = boardToAscii(b);
    expect(out.every((row) => row[2] === '.')).toBe(true);
  });
});

describe('weld invariant', () => {
  it('holds across a long random sequence of clears and settles', () => {
    // Fuzz: repeatedly drop random welded 2x2 blocks, resolve, and assert the invariant
    // never breaks. A violation here would mean fillBloc can leak across empty space.
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };

    const rows: string[] = [];
    for (let iter = 0; iter < 200; iter++) {
      const col = rand(9);
      const line = Array.from({ length: 10 }, (_, i) =>
        i === col || i === col + 1 ? 'X' : '.',
      ).join('');
      rows.push(line);
      if (rows.length > 12) rows.shift();

      const b = boardFromAscii(rows);
      resolve(b);
      assertWeldInvariant(b);
    }
  });
});
