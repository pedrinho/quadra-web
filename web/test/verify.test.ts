import { describe, it, expect } from 'vitest';
import { Game } from '../src/engine/game.js';
import { Action, groupsFromBindings } from '../src/engine/canvas.js';
import { Random } from '../src/engine/random.js';
import { DEFAULT_KEYS } from '../src/settings.js';
import { record } from '../src/replay/recorder.js';
import { replay } from '../src/replay/playback.js';
import { stateHash } from '../src/replay/hash.js';
import {
  ByteWriter,
  EventOp,
  decodeTape,
  encodeFrame,
  encodeHeader,
  encodeTape,
  type TapeHeader,
} from '../src/replay/tape.js';
import { SIM_VERSION } from '../src/replay/version.js';
import { verify } from '../src/replay/verify.js';
import { Autoplayer, SCORING_SEED } from './autoplay.js';

const IDENTITY_GROUPS = groupsFromBindings(DEFAULT_KEYS);

const header = (over: Partial<TapeHeader> = {}): TapeHeader => ({
  simVersion: SIM_VERSION,
  seed: 12345n,
  level: 1,
  levelUp: true,
  shadow: false,
  continuous: true,
  hSensitivity: 50,
  vSensitivity: 50,
  keyGroups: IDENTITY_GROUPS,
  startedAt: 1_770_000_000_000,
  ...over,
});

/** A real recording of the stacker, played to a score. */
const recorded = (frames = 6000, seed = SCORING_SEED) => {
  const game = new Game({ seed, shadow: true });
  const recorder = record(game, { startedAt: 1_770_000_000_000 });
  const player = new Autoplayer(game);
  for (let i = 0; i < frames && !game.isOver; i++) {
    player.frame();
    game.stepFrame(1);
  }
  return { game, bytes: recorder.bytes() };
};

describe('verifying a real run', () => {
  it('derives the score from the tape rather than believing one', () => {
    const { game, bytes } = recorded();
    const result = verify(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toBe(game.canvas.score);
    expect(result.lines).toBe(game.canvas.linesTot);
    expect(result.level).toBe(game.canvas.level);
    expect(result.frames).toBe(game.frame);
    expect(result.ticks).toBe(game.ticks);
    expect(result.over).toBe(true);
    expect(result.stateHash).toBe(stateHash(game));
    expect(result.score).toBeGreaterThan(0);
  });

  it('refuses a tape recorded by a different simulation', () => {
    const { bytes } = recorded(500);
    // The sim version sits at bytes 5-6, right after the magic and the format byte.
    bytes[5] = (SIM_VERSION + 1) & 0xff;
    const result = verify(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('sim-version-mismatch');
    // Refused before simulating: an engine that has moved on cannot certify an old score.
    expect(result.frame).toBe(0);
  });

  it('has nowhere to put a score, so shopping for a better one means a different game', () => {
    // The format carries no score at all: the number comes out of the simulation. Editing the
    // one thing a cheat would want to edit — the seed the pieces come from — produces a
    // different game, not a better result for the same one.
    const { game, bytes } = recorded();
    const honest = verify(bytes);
    expect(honest.ok).toBe(true);

    const tape = decodeTape(bytes);
    const swapped = { ...tape, header: { ...tape.header, seed: game.start.seed + 1n } };
    // The recorded checkpoints describe the game that was played, so the swap is caught at the
    // first one rather than at the end.
    expect(verify(encodeTape(swapped))).toMatchObject({
      ok: false,
      code: 'checkpoint-mismatch',
    });

    // And with the checkpoints stripped out, all that is left is a different game: the score
    // is whatever those inputs produce on that seed, which is not the score being claimed.
    const stripped = {
      ...swapped,
      frames: swapped.frames.map((f) => ({
        ...f,
        events: f.events.filter((e) => e.op !== EventOp.Checkpoint),
      })),
    };
    const tampered = verify(encodeTape(stripped));
    expect(tampered.ok).toBe(true);
    if (honest.ok && tampered.ok) {
      expect(tampered.score).not.toBe(honest.score);
      expect(tampered.stateHash).not.toBe(honest.stateHash);
    }
  });
});

describe('verifying is total', () => {
  // A short tape, so every prefix and every byte flip can be tried without the suite crawling.
  const short = () => recorded(400, 909).bytes;

  it('answers, rather than throws, for every truncation of a valid tape', () => {
    const bytes = short();
    expect(verify(bytes).ok).toBe(true);
    for (let n = 0; n < bytes.length; n++) {
      const result = verify(bytes.slice(0, n));
      expect(result.ok, `prefix of length ${n}`).toBe(false);
      if (!result.ok) expect(result.code, `prefix of length ${n}`).not.toBe('internal');
    }
  });

  it('answers for every single-byte corruption', () => {
    const original = short();
    for (let i = 0; i < original.length; i++) {
      for (const xor of [0x01, 0x40, 0xff]) {
        const bytes = original.slice();
        bytes[i]! ^= xor;
        const result = verify(bytes);
        // Either it is rejected or it is a different but coherent game — never a crash and
        // never a hang. The tick ceiling is what bounds the work, not a timer, so this cannot
        // flake on a slow machine.
        if (!result.ok) expect(result.code, `byte ${i} ^ ${xor}`).not.toBe('internal');
      }
    }
  });

  it('rejects something that is not a tape at all', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(4096)]) {
      const result = verify(bytes);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.frame).toBe(0);
    }
  });
});

describe('hostile tapes', () => {
  const withBody = (frames: number, ticks: number, body: (w: ByteWriter) => void): Uint8Array => {
    const w = new ByteWriter();
    body(w);
    const head = encodeHeader(header(), frames, ticks);
    const rest = w.finish();
    const out = new Uint8Array(head.length + rest.length);
    out.set(head, 0);
    out.set(rest, head.length);
    return out;
  };

  it('refuses a tape that is simply too big to be a game', () => {
    const result = verify(new Uint8Array(2 * 1024 * 1024));
    expect(result).toMatchObject({ ok: false, code: 'limit-bytes', frame: 0 });
  });

  it('refuses an absurd frame count without simulating anything', () => {
    // Run-length encoding means eight bytes can claim a billion frames.
    const bytes = withBody(1_000_000_000, 1_000_000_000, (w) => {
      encodeFrame(w, { events: [], ticks: 1, jump: 0 }, 999_999_999);
    });
    expect(verify(bytes)).toMatchObject({ ok: false, code: 'limit-frames', frame: 0 });
  });

  it('refuses an absurd tick total without simulating anything', () => {
    const bytes = withBody(10, 50_000_000, (w) => {
      for (let i = 0; i < 10; i++) encodeFrame(w, { events: [], ticks: 5_000_000, jump: 0 });
    });
    expect(verify(bytes)).toMatchObject({ ok: false, code: 'limit-ticks', frame: 0 });
  });

  it('refuses a single frame that claims more ticks than a frame can hold', () => {
    // The declared totals are honest here, so this can only be caught while streaming: one
    // frame record asking for thirty thousand ticks of CPU.
    const bytes = withBody(2, 30_001, (w) => {
      encodeFrame(w, { events: [], ticks: 1, jump: 0 });
      encodeFrame(w, { events: [], ticks: 30_000, jump: 0 });
    });
    const result = verify(bytes);
    expect(result).toMatchObject({ ok: false, code: 'limit-ticks-per-frame' });
    if (!result.ok) expect(result.frame).toBe(1); // stopped on the frame that lied
  });

  it('refuses a clock that skips more than a day', () => {
    const bytes = withBody(3, 3, (w) => {
      for (let i = 0; i < 3; i++) encodeFrame(w, { events: [], ticks: 1, jump: 40_000_000 });
    });
    expect(verify(bytes)).toMatchObject({ ok: false, code: 'limit-jump' });
  });

  it('refuses a body that does not add up to the header', () => {
    const bytes = withBody(2, 99, (w) => {
      encodeFrame(w, { events: [], ticks: 1, jump: 0 }, 1);
    });
    expect(verify(bytes)).toMatchObject({ ok: false, code: 'bad-header' });
  });

  it('refuses bytes hanging off the end of the last frame', () => {
    const bytes = withBody(1, 1, (w) => {
      encodeFrame(w, { events: [], ticks: 1, jump: 0 });
      w.u8(0x00);
    });
    expect(verify(bytes)).toMatchObject({ ok: false, code: 'trailing-bytes' });
  });

  it('refuses a checkpoint that does not describe the game the tape produces', () => {
    const bytes = withBody(2, 2, (w) => {
      encodeFrame(w, {
        events: [{ op: EventOp.Checkpoint, lanes: [1, 2], score: 999_999 }],
        ticks: 1,
        jump: 0,
      });
      encodeFrame(w, { events: [], ticks: 1, jump: 0 });
    });
    expect(verify(bytes)).toMatchObject({ ok: false, code: 'checkpoint-mismatch' });
  });

  it('keeps its own limits configurable, so a caller can be stricter than the default', () => {
    const { bytes } = recorded(400, 909);
    expect(verify(bytes).ok).toBe(true);
    expect(verify(bytes, { limits: { maxFrames: 100 } })).toMatchObject({
      ok: false,
      code: 'limit-frames',
    });
  });
});

describe('replay determinism, at scale', () => {
  it('reproduces two hundred randomly scripted games exactly', () => {
    // Seeded, so a failure is reproducible rather than a mystery in CI. Each script presses
    // and releases at random, which reaches key combinations no handwritten test would.
    const rng = new Random(20260806n);
    let simulated = 0;
    for (let run = 0; run < 200; run++) {
      const seed = rng.rnd() * 65_536 + rng.rnd();
      const game = new Game({ seed, shadow: run % 2 === 0 });
      const recorder = record(game, { checkpointInterval: 500 });
      for (let i = 0; i < 2000 && !game.isOver; i++) {
        const roll = rng.rnd(0xff);
        if (roll < 40) game.input((roll % 7) as Action, true);
        else if (roll < 80) game.input((roll % 7) as Action, false);
        else if (roll === 200) game.setPaused(!game.paused);
        game.stepFrame(1);
      }
      const bytes = recorder.bytes();
      const result = verify(bytes);
      expect(result.ok, `run ${run}, seed ${seed}`).toBe(true);
      if (!result.ok) return;
      expect(result.stateHash, `run ${run}, seed ${seed}`).toBe(stateHash(game));
      expect(stateHash(replay(recorder.tape())), `run ${run}, seed ${seed}`).toBe(stateHash(game));
      simulated += result.frames;
    }
    // Guards the guard: random play tops out quickly, and a version of this that died on
    // frame three every time would pass every assertion above while proving nothing.
    expect(simulated).toBeGreaterThan(100_000);
  });
});
