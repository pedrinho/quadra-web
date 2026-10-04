import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRec, RecError, recRefusal } from '../src/replay/rec.js';
import { playRec, percentFromRepeat } from '../src/replay/rec-playback.js';

/**
 * A demo recorded by the 1998 game, replayed by this engine.
 *
 * This is the strongest fidelity evidence the port has, and it is a different kind of evidence
 * from every other test here. The oracle tests compare against a C++ build we run ourselves, on
 * inputs we chose; `Buk14clean.rec` is four and a half minutes of somebody playing well in 2000,
 * recorded by a program nobody involved in this port has ever run, and it carries the score its
 * player finished on. Reaching that same score from nothing but the seed and the keystrokes means
 * the piece stream, the collision, the cascade, the soft drop and the scoring are all right, over
 * 27832 frames, with no opportunity to have tuned anything toward the answer.
 *
 * If this ever fails, the port has drifted and the leaderboard is measuring something else.
 */
describe('a 1998 .rec demo', () => {
  const file = new Uint8Array(readFileSync(new URL('./fixtures/Buk14clean.rec', import.meta.url)));

  it('parses into its hunks', async () => {
    const demo = await parseRec(file);
    expect(demo.seed).toBe(482340);
    // "Faster" — the recording carries the player's repeat speed, not this port's setting.
    expect(demo.repeat[0]).toBe(3);
    expect(percentFromRepeat(demo.repeat[0])).toBe(100);
    expect(demo.singlePlayer).toBe(0);
    expect(demo.input.length).toBe(21503);
    expect(demo.packetFormat).toBe(false);
    expect(recRefusal(demo)).toBeNull();
  });

  it('carries the trailer the original wrote', async () => {
    const demo = await parseRec(file);
    expect(demo.info).toEqual({ name: 'BuK LaO', score: 362179, lines: 149, level: 10 });
    expect(demo.summary?.get('version')).toBe('20');
    expect(demo.summary?.get('duration')).toBe('27832');
  });

  it('replays to the score its player finished on', async () => {
    const demo = await parseRec(file);
    const outcome = playRec(demo);

    expect(outcome.lines).toBe(demo.info?.lines);
    expect(outcome.level).toBe(demo.info?.level);
    expect(outcome.score).toBe(demo.info?.score);
    // Spelled out as well as compared, so a failure says which number moved.
    expect(outcome.lines).toBe(149);
    expect(outcome.level).toBe(10);
    expect(outcome.score).toBe(362179);
  });

  it('consumes the whole input stream and ends in a top-out', async () => {
    const demo = await parseRec(file);
    const outcome = playRec(demo);
    expect(outcome.complete).toBe(true);
    expect(outcome.over).toBe(true);
    // `duration` in the summary is the recorder's own frame count for the whole session.
    expect(outcome.frames).toBeLessThanOrEqual(Number(demo.summary?.get('duration')));
  });
});

describe('refusing what cannot be played', () => {
  it('rejects a file that is not a recording', async () => {
    await expect(parseRec(new Uint8Array([1, 2, 3]))).rejects.toThrow(RecError);
    // Long enough to get past the length check, still not a zlib stream.
    await expect(parseRec(new Uint8Array(64))).rejects.toThrow(RecError);
  });

  // Seventeen of the eighteen upstream demos are packet-form, and `16linesingle.rec` is one of
  // them while being a single-player run — so the refusal must not say "multiplayer".
  it('names the packet format rather than calling a solo run multiplayer', () => {
    const refusal = recRefusal({
      seed: 0,
      repeat: [2, 2, 2],
      singlePlayer: 0,
      input: new Uint8Array(0),
      packetFormat: true,
    });
    expect(refusal).toMatch(/packet format/i);
    expect(refusal).not.toMatch(/multiplayer/i);
  });
});
