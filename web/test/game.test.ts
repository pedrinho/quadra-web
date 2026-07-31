import { describe, it, expect } from 'vitest';
import { Game, TICK_MS, MAX_ACCUMULATOR_MS } from '../src/engine/game.js';
import { Action } from '../src/engine/canvas.js';
import { boardToAscii, PLAY_BOTTOM, PLAY_LEFT, PLAY_RIGHT } from '../src/engine/board.js';
import { assertWeldInvariant } from '../src/engine/cascade.js';
import { Random } from '../src/engine/random.js';
import { baseScore, levelThreshold } from '../src/engine/rules.js';

describe('game bootstrap', () => {
  it('fills the preview pipeline and hands over the first LCG draw', () => {
    const g = new Game({ seed: 12345 });
    g.runFrames(4);

    // The first piece the player gets is the first value the LCG produces.
    const expected = new Random(12345).rnd() % 7;
    expect(g.canvas.bloc).not.toBeNull();
    expect(g.canvas.bloc!.quel).toBe(expected);

    // Three previews are queued behind it.
    expect(g.canvas.next).not.toBeNull();
    expect(g.canvas.next2).not.toBeNull();
    expect(g.canvas.next3).not.toBeNull();
  });

  it('spawns at the documented position', () => {
    const g = new Game({ seed: 1 });
    g.runFrames(4);
    expect(g.canvas.bloc!.bx).toBe(7);
    // by is derived from the fixed-point y, which starts one cell high so the piece
    // slides in from above.
    expect(g.canvas.bloc!.by).toBeLessThanOrEqual(10);
  });

  it('produces the same piece sequence for the same seed', () => {
    const pieces = (seed: number) => {
      const g = new Game({ seed });
      const seen: number[] = [];
      let last = -1;
      for (let i = 0; i < 3000; i++) {
        g.runFrames(1);
        const b = g.canvas.bloc;
        if (b && b.quel !== last) {
          seen.push(b.quel);
          last = b.quel;
        }
      }
      return seen;
    };
    expect(pieces(999)).toEqual(pieces(999));
    expect(pieces(999)).not.toEqual(pieces(1000));
  });
});

describe('timing', () => {
  it('runs one simulation tick per 10ms of wall clock', () => {
    const g = new Game({ seed: 1 });
    g.advance(100);
    expect(g.frame).toBe(10);
    g.advance(35);
    expect(g.frame).toBe(13); // 5ms carried in the accumulator
    g.advance(5);
    expect(g.frame).toBe(14);
  });

  it('skips rather than simulates a large backlog', () => {
    const g = new Game({ seed: 1 });
    g.advance(2000);

    // A 2-second stall bounds the work done: only the last 300ms is simulated.
    expect(g.ticks).toBe(MAX_ACCUMULATOR_MS / TICK_MS);

    // But the clock is still advanced by the whole stall, so anything keyed off the frame
    // counter stays honest rather than silently running in slow motion.
    expect(g.frame).toBe(2000 - MAX_ACCUMULATOR_MS + MAX_ACCUMULATOR_MS / TICK_MS);
  });
});

describe('gravity and stamping', () => {
  it('drops a piece to the floor and welds it into the board', () => {
    const g = new Game({ seed: 42 });
    g.runFrames(4);
    const quel = g.canvas.bloc!.quel;

    g.canvas.pressKey(Action.Drop);
    g.runUntil(() => g.canvas.bloc === null || g.canvas.bloc.quel !== quel, 2000);

    // Something is now resting on the floor.
    let occupied = 0;
    for (let r = PLAY_BOTTOM - 4; r < PLAY_BOTTOM; r++)
      for (let c = PLAY_LEFT; c < PLAY_RIGHT; c++) if (g.canvas.isOccupied(r, c)) occupied++;
    expect(occupied).toBeGreaterThan(0);
    assertWeldInvariant(g.canvas);
  });

  it('stamps a piece as exactly four welded cells', () => {
    const g = new Game({ seed: 7 });
    g.runFrames(4);

    g.canvas.pressKey(Action.Drop);
    g.runUntil(() => g.canvas.bloc === null, 2000);
    // Let the stamp and line check resolve.
    g.runFrames(10);

    const rows = boardToAscii(g.canvas);
    const cells = rows.join('').split('').filter((ch) => ch !== '.');
    expect(cells).toHaveLength(4);
    // All four belong to one group — the piece is welded to itself and nothing else.
    expect(new Set(cells).size).toBe(1);
    assertWeldInvariant(g.canvas);
  });

  it('falls faster at higher levels', () => {
    const framesToLand = (level: number) => {
      const g = new Game({ seed: 5, level, levelUp: false });
      g.runFrames(4);
      return g.runUntil(() => g.canvas.bloc === null, 5000);
    };
    expect(framesToLand(10)).toBeLessThan(framesToLand(1));
  });
});

describe('movement', () => {
  it('moves left and right, with the initial DAS delay before repeating', () => {
    const g = new Game({ seed: 3 });
    // Entering a module costs a frame: Executor::step runs init() *instead of* step() on a
    // module's first scheduled frame. Getting from spawn into PlayerProcessKey's step loop
    // therefore takes several frames, so settle in before measuring.
    g.runFrames(10);
    const startX = g.canvas.bloc!.bx;

    g.canvas.pressKey(Action.Left);
    g.runFrames(1);
    // First press moves immediately.
    expect(g.canvas.bloc!.bx).toBe(startX - 1);

    // The next move waits out the initial delay (hRepeatDelay + 10), so a couple of
    // frames later it has not moved again.
    g.runFrames(2);
    expect(g.canvas.bloc!.bx).toBe(startX - 1);

    // Held long enough, it repeats.
    g.runFrames(20);
    expect(g.canvas.bloc!.bx).toBeLessThan(startX - 1);
  });

  it('will not push a piece through the wall', () => {
    const g = new Game({ seed: 3, level: 1 });
    g.runFrames(4);
    g.canvas.pressKey(Action.Left);
    g.runFrames(300);
    expect(g.canvas.bloc?.bx ?? PLAY_LEFT).toBeGreaterThanOrEqual(0);
    // Whatever landed must still satisfy the weld invariant.
    assertWeldInvariant(g.canvas);
  });

  it('rotates on key release, not on press', () => {
    const g = new Game({ seed: 11 });
    g.runFrames(4);
    // Use a piece that actually changes shape when rotated.
    while (g.canvas.bloc!.quel === 0) {
      g.canvas.pressKey(Action.Drop);
      g.runUntil(() => g.canvas.bloc === null, 500);
      g.runFrames(20);
    }
    const rot0 = g.canvas.bloc!.rot;

    g.canvas.pressKey(Action.RotateLeft);
    g.runFrames(2);
    expect(g.canvas.bloc!.rot).toBe(rot0); // still held — no rotation

    g.canvas.releaseKey(Action.RotateLeft);
    g.runFrames(2);
    expect(g.canvas.bloc!.rot).not.toBe(rot0);
  });
});

describe('scoring', () => {
  it('matches the original score curve', () => {
    expect(baseScore(1, 1, false)).toBe(250);
    expect(baseScore(2, 1, false)).toBe(500);
    expect(baseScore(3, 1, false)).toBe(1000);
    expect(baseScore(4, 1, false)).toBe(2000);
    expect(baseScore(5, 1, false)).toBe(200 * 25);
  });

  it('rewards cascades quadratically', () => {
    // Same lines cleared, but chained — worth dramatically more.
    expect(baseScore(2, 1, false)).toBe(500);
    expect(baseScore(2, 2, false)).toBe(500 + 200);
    expect(baseScore(2, 3, false)).toBe(500 + 800);
    expect(baseScore(2, 5, false)).toBe(500 + 3200);
  });

  it('adds the clean-board bonus', () => {
    expect(baseScore(4, 1, true)).toBe(2000 + 4 * 1250);
    expect(baseScore(5, 1, true)).toBe(200 * 25 + 25 * 500);
  });

  it('uses a cumulative level threshold', () => {
    expect(levelThreshold(1)).toBe(15);
    expect(levelThreshold(2)).toBe(30);
    expect(levelThreshold(3)).toBe(45);
  });
});

describe('long run stability', () => {
  it('survives a full game to top-out without breaking the weld invariant', () => {
    const g = new Game({ seed: 20260730 });
    let frames = 0;
    while (!g.isOver && frames < 60_000) {
      g.runFrames(1);
      frames++;
      if (frames % 500 === 0) assertWeldInvariant(g.canvas);
    }
    assertWeldInvariant(g.canvas);
    // With no input at all, pieces stack in the spawn column and the player tops out.
    expect(g.isOver).toBe(true);
    expect(g.canvas.linesTot).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic across identical runs', () => {
    const play = () => {
      const g = new Game({ seed: 555 });
      for (let i = 0; i < 4000; i++) {
        if (i % 37 === 0) g.canvas.pressKey(Action.Left);
        if (i % 53 === 0) g.canvas.releaseKey(Action.Left);
        if (i % 71 === 0) g.canvas.pressKey(Action.Drop);
        g.runFrames(1);
      }
      return { score: g.canvas.score, lines: g.canvas.linesTot, board: boardToAscii(g.canvas) };
    };
    expect(play()).toEqual(play());
  });
});
