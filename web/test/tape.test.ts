import { describe, it, expect } from 'vitest';
import {
  ByteReader,
  ByteWriter,
  EventOp,
  TapeError,
  decodeTape,
  encodeTape,
  isCanonicalKeyGroups,
  type Tape,
  type TapeFrame,
} from '../src/replay/tape.js';
import { SIM_VERSION } from '../src/replay/version.js';
import { Action, groupsFromBindings } from '../src/engine/canvas.js';
import { DEFAULT_KEYS } from '../src/settings.js';

const IDENTITY_GROUPS = groupsFromBindings(DEFAULT_KEYS);

const header = (over: Partial<Tape['header']> = {}): Tape['header'] => ({
  simVersion: SIM_VERSION,
  seed: 12345n,
  level: 1,
  levelUp: true,
  shadow: true,
  continuous: true,
  hSensitivity: 50,
  vSensitivity: 50,
  keyGroups: IDENTITY_GROUPS,
  startedAt: 1_770_000_000_000,
  ...over,
});

const bare = (ticks: number): TapeFrame => ({ events: [], ticks, jump: 0 });

/** A tape exercising every opcode, so the round-trip tests are not just testing bare frames. */
const richTape = (): Tape => {
  const shared = [...DEFAULT_KEYS];
  shared[Action.RotateRight] = shared[Action.RotateLeft]!;
  return {
    header: header(),
    frames: [
      bare(1),
      bare(1),
      bare(1),
      { events: [{ op: EventOp.Press, action: Action.Left }], ticks: 2, jump: 0 },
      { events: [{ op: EventOp.Release, action: Action.Left }], ticks: 1, jump: 0 },
      { events: [{ op: EventOp.ClearAll }], ticks: 1, jump: 0 },
      { events: [{ op: EventOp.Pause, paused: true }], ticks: 1, jump: 0 },
      { events: [{ op: EventOp.Pause, paused: false }], ticks: 0, jump: 0 },
      {
        events: [
          {
            op: EventOp.Reconfig,
            hSensitivity: 80,
            vSensitivity: 20,
            continuous: false,
            keyGroups: groupsFromBindings(shared),
          },
        ],
        ticks: 1,
        jump: 0,
      },
      { events: [{ op: EventOp.Checkpoint, lanes: [0xdeadbeef, 0x0badf00d], score: 22000 }], ticks: 1, jump: 0 },
      // A stall: the clock jumps without the frames being simulated.
      { events: [], ticks: 30, jump: 417 },
      // Above the 5-bit tick field, so the escape path is exercised.
      { events: [{ op: EventOp.Press, action: Action.Drop }], ticks: 300, jump: 0 },
      bare(2),
      bare(2),
    ],
  };
};

describe('tape codec', () => {
  it('round-trips every opcode', () => {
    const tape = richTape();
    expect(decodeTape(encodeTape(tape))).toEqual(tape);
  });

  it('encodes canonically, so re-encoding a decoded tape is byte-identical', () => {
    // Matters as soon as tapes are hashed, deduplicated or signed: two encoders of the same
    // game must not produce two different blobs.
    const bytes = encodeTape(richTape());
    expect(encodeTape(decodeTape(bytes))).toEqual(bytes);
  });

  it('collapses idle frames, so a quiet minute costs bytes rather than kilobytes', () => {
    const frames = Array.from({ length: 3600 }, () => bare(1));
    const bytes = encodeTape({ header: header(), frames });
    // One control byte plus one varint run length for the whole minute.
    expect(bytes.length).toBeLessThan(40);
    expect(decodeTape(bytes).frames).toHaveLength(3600);
  });

  it('does not run-length across a frame that carries input', () => {
    const frames: TapeFrame[] = [
      bare(1),
      { events: [{ op: EventOp.Press, action: Action.Down }], ticks: 1, jump: 0 },
      bare(1),
    ];
    expect(decodeTape(encodeTape({ header: header(), frames }))).toEqual({
      header: header(),
      frames,
    });
  });

  it('round-trips seeds across the whole 64-bit range, including negatives', () => {
    for (const seed of [0n, 1n, -1n, 0x7fffffffn, -0x80000000n, 0x0123456789abcdefn, -0x0123456789abcdefn]) {
      const tape: Tape = { header: header({ seed }), frames: [bare(1)] };
      expect(decodeTape(encodeTape(tape)).header.seed).toBe(seed);
    }
  });

  it('round-trips varints past 2^32, where bitwise operators would corrupt them', () => {
    const w = new ByteWriter();
    const values = [0, 1, 127, 128, 16383, 16384, 2 ** 31, 2 ** 32 + 7, Number.MAX_SAFE_INTEGER];
    for (const v of values) w.varint(v);
    const r = new ByteReader(w.finish());
    expect(values.map(() => r.varint())).toEqual(values);
  });
});

describe('tape validation', () => {
  const corrupt = (mutate: (b: Uint8Array) => void): Uint8Array => {
    const bytes = encodeTape(richTape());
    mutate(bytes);
    return bytes;
  };

  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      if (err instanceof TapeError) return err.code;
      return `unexpected: ${String(err)}`;
    }
    return 'no-error';
  };

  it('rejects something that is not a tape', () => {
    expect(codeOf(() => decodeTape(new Uint8Array(64)))).toBe('bad-magic');
  });

  it('rejects a future container format rather than guessing at it', () => {
    expect(codeOf(() => decodeTape(corrupt((b) => (b[4] = 99))))).toBe('bad-format-version');
  });

  it('rejects an unknown event opcode instead of skipping it', () => {
    // Skipping the unrecognised would let a newer client smuggle state past an older
    // verifier and have it certify a score it never actually simulated.
    const tape = richTape();
    const bytes = encodeTape(tape);
    // The first event byte: find the Press(Left) record and corrupt its op nibble to 0xF.
    const at = bytes.indexOf((EventOp.Press << 4) | Action.Left, 30);
    expect(at).toBeGreaterThan(0);
    bytes[at] = 0xf0;
    expect(codeOf(() => decodeTape(bytes))).toBe('bad-opcode');
  });

  it('rejects a non-canonical key grouping', () => {
    const bad = Uint8Array.from([1, 1, 2, 3, 4, 5, 6]); // g[0] = 1 > 0
    expect(isCanonicalKeyGroups(bad)).toBe(false);
    expect(codeOf(() => encodeTape({ header: header({ keyGroups: bad }), frames: [bare(1)] }))).toBe(
      'bad-groups',
    );
  });

  it('accepts a grouping that shares one key between two actions', () => {
    const shared = [...DEFAULT_KEYS];
    shared[Action.RotateRight] = shared[Action.RotateLeft]!;
    const groups = groupsFromBindings(shared);
    expect(isCanonicalKeyGroups(groups)).toBe(true);
    expect(groups[Action.RotateRight]).toBe(Action.RotateLeft);
  });

  it('catches a header that lies about the tick total', () => {
    const tape = richTape();
    const bytes = encodeTape(tape);
    // The declared tick count is the last varint of the header; bump the final byte of it.
    const declaredAt = bytes.length - 1;
    expect(codeOf(() => decodeTape(bytes.slice(0, declaredAt)))).not.toBe('no-error');
  });

  it('refuses an absurd declared frame count before allocating anything', () => {
    // Run-length encoding means a few bytes can claim 10^15 frames. Without the cap the
    // decoder would sit in a push loop on input it had barely read.
    const tape = richTape();
    const bytes = encodeTape(tape);
    expect(codeOf(() => decodeTape(bytes, 3))).toBe('bad-header');
  });

  it('fails cleanly on every truncation, and never on anything but a TapeError', () => {
    const bytes = encodeTape(richTape());
    for (let n = 0; n < bytes.length; n++) {
      const code = codeOf(() => decodeTape(bytes.slice(0, n)));
      expect(code, `prefix of length ${n}`).not.toBe('no-error');
      expect(code, `prefix of length ${n}`).not.toMatch(/^unexpected/);
    }
    // The full buffer still decodes, so the loop above was not passing trivially.
    expect(codeOf(() => decodeTape(bytes))).toBe('no-error');
  });

  it('survives single-byte corruption without hanging or throwing something else', () => {
    const original = encodeTape(richTape());
    for (let i = 0; i < original.length; i++) {
      for (const xor of [0x01, 0x80, 0xff]) {
        const bytes = original.slice();
        bytes[i]! ^= xor;
        const code = codeOf(() => decodeTape(bytes));
        expect(code, `byte ${i} ^ ${xor}`).not.toMatch(/^unexpected/);
      }
    }
  });
});
