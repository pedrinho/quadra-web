import { describe, it, expect } from 'vitest';
import { boardFromAscii } from '../src/engine/board.js';
import { Hasher, boardHash, stateHash } from '../src/replay/hash.js';
import { Game } from '../src/engine/game.js';
import { Action } from '../src/engine/canvas.js';

describe('board hash', () => {
  it('is a stable 64-bit hex digest', () => {
    const h = boardHash(boardFromAscii(['AA........']));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(boardHash(boardFromAscii(['AA........']))).toBe(h);
  });

  it('distinguishes boards that differ only in their welds', () => {
    // The whole point. Identical occupancy, different groups: one falls as a single rigid
    // body, the other as two. A hash over occupancy alone would call these the same board
    // and a desync check built on it would never fire.
    const oneGroup = boardFromAscii(['AAAA......']);
    const twoGroups = boardFromAscii(['AABB......']);
    expect(boardHash(oneGroup)).not.toBe(boardHash(twoGroups));
  });

  it('notices a single changed cell', () => {
    expect(boardHash(boardFromAscii(['AA........']))).not.toBe(
      boardHash(boardFromAscii(['AA.......B'])),
    );
  });

  it('notices a cell in the hidden spawn buffer', () => {
    // Rows above the visible playfield still decide collision and top-out, so they are part
    // of the state even though nothing draws them.
    const empty = boardFromAscii([]);
    const occupied = boardFromAscii([]);
    occupied.setCell(2, 5, 0, 1);
    expect(boardHash(empty)).not.toBe(boardHash(occupied));
  });
});

describe('state hash', () => {
  const play = (seed: number, frames: number, act?: () => void): Game => {
    const g = new Game({ seed, level: 1 });
    act?.();
    g.runFrames(frames);
    return g;
  };

  it('agrees for two games given the same seed and the same input', () => {
    expect(stateHash(play(7, 200))).toBe(stateHash(play(7, 200)));
  });

  it('disagrees for different seeds, because the piece stream differs', () => {
    expect(stateHash(play(7, 200))).not.toBe(stateHash(play(8, 200)));
  });

  it('disagrees for the same seed with different input', () => {
    const a = new Game({ seed: 7, level: 1 });
    const b = new Game({ seed: 7, level: 1 });
    a.runFrames(50);
    b.input(Action.Left, true);
    b.runFrames(50);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('disagrees when only the clock has moved on', () => {
    const a = play(7, 200);
    const b = play(7, 201);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('covers the sticky key state, which survives across frames', () => {
    const a = new Game({ seed: 7, level: 1 });
    const b = new Game({ seed: 7, level: 1 });
    a.runFrames(30);
    b.runFrames(30);
    expect(stateHash(a)).toBe(stateHash(b));
    b.input(Action.RotateLeft, true);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('covers the tuning derived from sensitivity, which changes how input behaves', () => {
    const a = new Game({ seed: 7, level: 1, hSensitivity: 10 });
    const b = new Game({ seed: 7, level: 1, hSensitivity: 90 });
    a.runFrames(30);
    b.runFrames(30);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});

describe('hasher', () => {
  it('refuses a fractional value rather than silently truncating it', () => {
    // A fractional framecount is exactly the bug this guards: it used to be possible for the
    // backlog skip to make the master clock non-integer.
    expect(() => new Hasher().int(1.5)).toThrow(/integer/);
  });

  it('is order-sensitive', () => {
    expect(new Hasher().byte(1).byte(2).digest()).not.toBe(new Hasher().byte(2).byte(1).digest());
  });
});
