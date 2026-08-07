import { describe, it, expect } from 'vitest';
import { Game } from '../src/engine/game.js';
import { record } from '../src/replay/recorder.js';
import { replay } from '../src/replay/playback.js';
import { decodeTape } from '../src/replay/tape.js';
import { SIM_VERSION } from '../src/replay/version.js';
import {
  MAX_RUNS,
  MAX_TAPE_BYTES,
  clearRuns,
  fromBase64,
  isStale,
  loadRuns,
  saveRun,
  tapeOf,
  toBase64,
} from '../src/leaderboard.js';
import { Autoplayer, SCORING_SEED } from './autoplay.js';

/** localStorage stands in for a server here, so the tests give it one that misbehaves too. */
class FakeStorage {
  readonly map = new Map<string, string>();
  full = false;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(key, value);
  }
}

const tapeFor = (seed: number, frames = 6000): Uint8Array => {
  const game = new Game({ seed, shadow: true });
  const recorder = record(game, { startedAt: 1_770_000_000_000 });
  const player = new Autoplayer(game);
  for (let i = 0; i < frames && !game.isOver; i++) {
    player.frame();
    game.stepFrame(1);
  }
  return recorder.bytes();
};

/** A board of runs that are not worth simulating, for testing the ranking itself. */
const fill = (store: FakeStorage, scores: number[]): void => {
  store.map.set(
    'quadra.runs.v1',
    JSON.stringify(
      scores.map((score, i) => ({
        id: `filler-${i}`,
        tape: 'AAA',
        score,
        frames: 100,
        lines: 1,
        level: 1,
        ticks: 100,
        seed: '1',
        simVersion: SIM_VERSION,
        startedAt: 1,
        savedAt: i,
        over: true,
        stateHash: `filler-${i}`,
      })),
    ),
  );
};

describe('saving a run', () => {
  it('takes the score from the tape, not from whoever submitted it', () => {
    const store = new FakeStorage();
    const bytes = tapeFor(SCORING_SEED);
    const result = saveRun(bytes, store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const replayed = replay(decodeTape(bytes));
    expect(result.run.score).toBe(replayed.canvas.score);
    expect(result.run.score).toBeGreaterThan(0);
    expect(result.rank).toBe(1);
    expect(result.run.simVersion).toBe(SIM_VERSION);
    expect(isStale(result.run)).toBe(false);
  });

  it('keeps the recording, so everything shown can be watched', () => {
    const store = new FakeStorage();
    const bytes = tapeFor(SCORING_SEED);
    const saved = saveRun(bytes, store);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const restored = tapeOf(loadRuns(store)[0]!);
    expect(restored).toEqual(bytes);
    expect(replay(decodeTape(restored!)).canvas.score).toBe(saved.run.score);
  });

  it('refuses a tape that does not verify', () => {
    const store = new FakeStorage();
    const bytes = tapeFor(SCORING_SEED, 500);
    bytes[bytes.length - 1] ^= 0xff;
    const result = saveRun(bytes, store);
    expect(result).toMatchObject({ ok: false, reason: 'unverifiable' });
    expect(loadRuns(store)).toEqual([]);
  });

  it('refuses a payload dressed up as a run', () => {
    const store = new FakeStorage();
    expect(saveRun(new Uint8Array(MAX_TAPE_BYTES + 1), store)).toMatchObject({
      ok: false,
      reason: 'too-big',
    });
  });

  it('will not take the same run twice', () => {
    const store = new FakeStorage();
    const bytes = tapeFor(SCORING_SEED);
    expect(saveRun(bytes, store).ok).toBe(true);
    expect(saveRun(bytes, store)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(loadRuns(store)).toHaveLength(1);
  });

  it('will not put a game nobody scored in on a leaderboard', () => {
    const store = new FakeStorage();
    // A real, verifiable run on a seed the stacker never clears a line on: nothing to show.
    const result = saveRun(tapeFor(909, 800), store);
    expect(result).toMatchObject({ ok: false, reason: 'not-a-record' });
    expect(loadRuns(store)).toEqual([]);
  });

  it('drops the weakest run when a better one arrives', () => {
    const store = new FakeStorage();
    fill(store, [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);

    const result = saveRun(tapeFor(SCORING_SEED), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rank).toBe(1);

    const board = loadRuns(store);
    expect(board).toHaveLength(MAX_RUNS);
    expect(board[0]!.score).toBe(result.run.score);
    expect(board.map((r) => r.score)).not.toContain(100);
    expect(board.map((r) => r.score)).toEqual([...board.map((r) => r.score)].sort((a, b) => b - a));
  });

  it('says so when a run did not make the board, rather than pretending it did', () => {
    const store = new FakeStorage();
    fill(store, [5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009]);
    expect(saveRun(tapeFor(SCORING_SEED), store)).toMatchObject({
      ok: false,
      reason: 'not-a-record',
    });
    expect(loadRuns(store)).toHaveLength(MAX_RUNS);
  });

  it('survives a storage that refuses to store', () => {
    const store = new FakeStorage();
    store.full = true;
    // A full quota must not take the game down with it; the run is simply not kept.
    expect(() => saveRun(tapeFor(SCORING_SEED), store)).not.toThrow();
    expect(loadRuns(store)).toEqual([]);
  });

  it('does nothing at all when there is no storage', () => {
    expect(loadRuns(null)).toEqual([]);
    expect(() => clearRuns(null)).not.toThrow();
    expect(saveRun(tapeFor(SCORING_SEED), null).ok).toBe(true);
  });
});

describe('reading the board back', () => {
  it('treats what it stored as hostile, because the player can edit it', () => {
    const store = new FakeStorage();
    store.map.set(
      'quadra.runs.v1',
      JSON.stringify([
        { id: 'a', tape: 'AAA', score: 100, frames: 10 },
        { id: 'b', tape: 'AAA', score: 'lots', frames: 10 }, // not a number
        { id: 'c', tape: 42, score: 100, frames: 10 }, // not a string
        { score: 100, frames: 10 }, // no id
        null,
        'nonsense',
        { id: 'd', tape: 'AAA', score: -5, frames: 10 }, // negative
        { id: 'e', tape: 'AAA', score: 1.5, frames: 10 }, // fractional
      ]),
    );
    const runs = loadRuns(store);
    expect(runs.map((r) => r.id)).toEqual(['a']);
    // The survivor is filled out with defaults rather than carrying holes.
    expect(runs[0]).toMatchObject({ lines: 0, level: 1, over: false, seed: '0' });
  });

  it('shrugs at anything that is not a board at all', () => {
    const store = new FakeStorage();
    for (const junk of ['', '{}', 'null', '[', '"a string"', '{"runs":[]}']) {
      store.map.set('quadra.runs.v1', junk);
      expect(loadRuns(store), junk).toEqual([]);
    }
  });

  it('marks runs from another simulation instead of trusting their scores', () => {
    const store = new FakeStorage();
    saveRun(tapeFor(SCORING_SEED), store);
    const runs = loadRuns(store);
    runs[0]!.simVersion = SIM_VERSION + 1;
    store.map.set('quadra.runs.v1', JSON.stringify(runs));
    expect(isStale(loadRuns(store)[0]!)).toBe(true);
  });

  it('clears', () => {
    const store = new FakeStorage();
    saveRun(tapeFor(SCORING_SEED), store);
    expect(loadRuns(store)).toHaveLength(1);
    clearRuns(store);
    expect(loadRuns(store)).toEqual([]);
  });
});

describe('base64', () => {
  it('round-trips every byte value, at every offset mod 3', () => {
    for (let offset = 0; offset < 3; offset++) {
      const bytes = new Uint8Array(256 + offset);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i + offset) & 0xff;
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
  });

  it('handles a tape larger than the chunk it encodes in', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
