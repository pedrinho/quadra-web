import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { verify } from '../src/replay/verify.js';
import { boardHash } from '../src/replay/hash.js';
import { Board } from '../src/engine/board.js';
import { SIM_VERSION } from '../src/replay/version.js';

/**
 * Three recorded runs whose whole story is one move: a tower stacked without ever completing a
 * line, then one last piece that takes every row of it and leaves the board empty.
 *
 * Committed, and checked here for the same reason the demo is — they are claims about what this
 * engine does, and a claim in a binary file rots silently. They are sharper claims than the
 * demo's: twelve lines from a single piece only happens if clearing a row severs the welds
 * running through it, drops the fragments as rigid bodies and re-checks. If the cascade breaks,
 * these fail. Regenerate with `npx vite-node tools/record-clean.ts 8` (or `10`, `12`).
 *
 * The ten is the odd one out and worth keeping for it: ten rows will not divide into four-row
 * storeys, so its bottom storey is two rows deep and two columns wide and an O falls into it
 * where the others take a vertical I. Its whole tower is stacked against the left wall.
 */
describe.each([
  { lines: 8, seed: 2n, score: 49_500, frames: 2708, state: '541d140e76226fe9' },
  { lines: 10, seed: 9n, score: 77_880, frames: 1834, state: '32f03aa074138f05' },
  { lines: 12, seed: 77n, score: 111_760, frames: 1717, state: '8d524199c7446a88' },
])('the $lines-line clean', ({ lines, seed, score, frames, state }) => {
  const bytes = new Uint8Array(
    readFileSync(new URL(`../public/assets/clean${lines}.qtape`, import.meta.url)),
  );

  it('still verifies against this engine', () => {
    const result = verify(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header.simVersion).toBe(SIM_VERSION);
    expect(result.header.seed).toBe(seed);
  });

  it('replays to the lines and the score it claims', () => {
    const result = verify(bytes);
    if (!result.ok) throw new Error(result.message);
    expect(result.lines).toBe(lines);
    // 200·n² base, +200·(steps-1)² for the cascade, +500·n² for the clean board, +10% for level
    // one. Any of those four terms going missing lands somewhere other than here.
    expect(result.score).toBe(score);
    expect(result.frames).toBe(frames);
    // Level one throughout: the level-up threshold is fifteen lines and the run never gets there,
    // which is why the whole score is one move's worth rather than a curve.
    expect(result.level).toBe(1);
  });

  it('ends on an empty board', () => {
    const result = verify(bytes);
    if (!result.ok) throw new Error(result.message);
    // Compared against a board that has never been played on, which is the only statement of
    // "clean" that cannot drift with the scoring rules.
    expect(result.boardHash).toBe(boardHash(new Board()));
    // Unfinished by design — the player stopped once the board was clear.
    expect(result.over).toBe(false);
    expect(result.stateHash).toBe(state);
  });
});
