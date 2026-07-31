import { describe, it, expect } from 'vitest';
import { boardFromAscii, boardToAscii, Board } from '../src/engine/board.js';
import { formatDump, parseDumps, applyDumpRows, DUMP_START, DUMP_END } from '../src/engine/dump.js';
import { assertWeldInvariant, resolve } from '../src/engine/cascade.js';

describe('board dump interchange', () => {
  it('round-trips a board including its welds', () => {
    const original = boardFromAscii([
      '.AFFFFFFF.',
      'AAGGGGGGG.',
      'ABHHHHHHH.',
      'BBIIIIIII.',
      'B.JJJJJJJ.',
    ]);

    const text = formatDump(original);
    const dumps = parseDumps(text);
    expect(dumps).toHaveLength(1);

    const restored = new Board();
    applyDumpRows(restored, dumps[0]!);

    // Occupancy and edge masks must both survive, or the cascade would behave differently.
    expect(Array.from(restored.occupied)).toEqual(Array.from(original.occupied));
    expect(Array.from(restored.block)).toEqual(Array.from(original.block));
    expect(boardToAscii(restored)).toEqual(boardToAscii(original));
    assertWeldInvariant(restored);
  });

  it('preserves grouping, not just which cells are filled', () => {
    // Same occupancy, different welding: one welded bar vs ten loose cells.
    const welded = boardFromAscii(['AAAAAAAAAA']);
    const loose = boardFromAscii(['ABCDEFGHIJ']);
    expect(Array.from(welded.occupied)).toEqual(Array.from(loose.occupied));
    expect(formatDump(welded)).not.toEqual(formatDump(loose));
  });

  it('restores a board that then cascades identically', () => {
    const fixture = ['.........A', 'BBBBBBBBB.', 'CCCCCCCCCC', 'DDDDDDDDD.'];

    const direct = boardFromAscii(fixture);
    const viaDump = new Board();
    applyDumpRows(viaDump, parseDumps(formatDump(boardFromAscii(fixture)))[0]!);

    const a = resolve(direct);
    const b = resolve(viaDump);
    expect(b).toEqual(a);
    expect(boardToAscii(viaDump)).toEqual(boardToAscii(direct));
  });

  it('picks up every dump in a log and ignores surrounding noise', () => {
    const board = boardFromAscii(['AAAA......']);
    const log = [
      'INFO: some unrelated log line',
      formatDump(board),
      'INFO: another line',
      formatDump(board),
      'INFO: trailing',
    ].join('\n');
    expect(parseDumps(log)).toHaveLength(2);
  });

  it('rejects a malformed dump rather than silently importing a wrong board', () => {
    const short = [DUMP_START, '  01 02 03 ', DUMP_END].join('\n');
    const rows = parseDumps(short)[0]!;
    expect(() => applyDumpRows(new Board(), rows)).toThrow(/expected 20 rows/);

    const badCell = [DUMP_START, ...Array(20).fill('  zz '.repeat(10)), DUMP_END].join('\n');
    expect(() => applyDumpRows(new Board(), parseDumps(badCell)[0]!)).toThrow(/bad cell/);
  });

  it('matches the exact byte format the C++ emits', () => {
    // A single cell with all four edges exposed, colour 3: block byte = (3<<4)|15 = 0x3f.
    const b = new Board();
    b.setCell(31, 4, 15, 3);
    const line = formatDump(b).split('\n').at(-2)!;
    expect(line.trim().split(/\s+/)[0]).toBe('3f');
  });
});
