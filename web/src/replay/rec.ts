/*
 * Reading the 1998 game's own recordings.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A `.rec` is what `Recording`/`Playback` in source/recording.cc wrote and read. It is not a
 * tape and is never turned into one: a tape is this simulation's proof of a score, and minting
 * one from a file recorded by another program in 1998 would put a claim on the board that this
 * engine never produced. A `.rec` is only ever watched.
 *
 * What it carries is the same *kind* of thing a tape carries, which is why watching it works at
 * all: a seed and what the player did. The pieces, the cascades and the score are recomputed
 * here from the seed, so a demo that replays to the score written in its own trailer is evidence
 * the port is bit-exact against a run nobody here has ever seen.
 *
 * The container is `Res_compress`: a uint32 little-endian uncompressed length, then a zlib
 * stream. Inside is a flat sequence of hunks, each a one-byte tag — see `Playback::read_all`.
 */

/** Hunk tags, from the comment on `Recording` in source/recording.h:42-50. */
const enum Hunk {
  /** `read_seed`: the game seed and one repeat-speed per player slot. */
  Seed = 0,
  /** `read_single`: which player slot the recording is of. */
  Single = 1,
  /** `read_data`: the input byte stream, terminated by 0xFF. */
  Data = 2,
  /** `read_info`: name and final score of a single-player run. */
  Info = 3,
  /** `read_packet`: a netcode packet at a frame. The form we do not play — see `packetFormat`. */
  Packet = 11,
  /** `read_summary`: the Qserv-style key/value text `Recording::write_summary` appends. */
  Summary = 13,
}

/**
 * Player-slot name length. Forty bytes exactly, because `Recording::end_single` writes
 * `char[40]` and `Playback::read_info` reads the same — the field is fixed, not delimited.
 */
const NAME_BYTES = 40;

/**
 * The input bitfield `Player_process_key::playback_control` decodes — source/player.cc:284-296.
 *
 * One byte is consumed per `Player_process_key::step()`, and each bit calls a movement helper
 * *directly*: no key state, no DAS, no rotate-on-release. That is why a demo can be replayed
 * faithfully at all — there is nothing to reconstruct.
 */
export const enum RecInput {
  Down = 1,
  Left = 2,
  Right = 4,
  RotateLeft = 8,
  RotateRight = 16,
}

export type RecErrorCode = 'truncated' | 'bad-length' | 'not-deflate' | 'bad-hunk' | 'incomplete';

export class RecError extends Error {
  constructor(
    readonly code: RecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RecError';
  }
}

/** The trailer of a single-player run — `Playback::read_info`. */
export interface RecInfo {
  name: string;
  score: number;
  lines: number;
  level: number;
}

export interface RecDemo {
  /** `Random`'s starting state, an int32 widened the way `time_t seed` widens it. */
  seed: number;
  /** Repeat speed 0-3 per player slot: Slow / Normal / Fast / Faster. */
  repeat: [number, number, number];
  /** Which slot was recorded. Always 0 for the single-player demos. */
  singlePlayer: number;
  /** The input stream, one byte per `Player_process_key::step`, terminator stripped. */
  input: Uint8Array;
  info?: RecInfo;
  /** The summary text, parsed into its `key value` pairs. Absent on 1.0.1-era demos. */
  summary?: Map<string, string>;
  /**
   * Whether the file carries netcode packets rather than a hunk-2 input stream.
   *
   * Not the same question as "is it multiplayer", which is the mistake to avoid here: later
   * builds recorded *every* game through the netcode, so a solo run can arrive in packet form
   * too — `16linesingle.rec` in the upstream distribution is one, 141 lines by one player. What
   * the two forms differ in is where the input lives, and packet form puts it inside
   * `Packet_moves` alongside `Packet_gameserver`, `Packet_clientstampblock` and the rest of the
   * protocol. `Playback` calls the absence of packets `old_mode`, and old mode is what plays
   * here. See `recRefusal`.
   */
  packetFormat: boolean;
}

/**
 * Ceiling on the inflated body. The header's declared length is attacker-controlled, and the
 * largest demo in the upstream distribution is under a megabyte, so this is generous by an
 * order of magnitude and still refuses a decompression bomb before allocating for it.
 */
const MAX_INFLATED = 32 * 1024 * 1024;

/**
 * Inflate the zlib stream a `.rec` wraps its hunks in.
 *
 * `DecompressionStream` is a global in the browser and in Node 22, so this is one code path and
 * no dependency. 'deflate' is the zlib-wrapped format, which is what `Res_compress` wrote.
 */
async function inflate(body: Uint8Array): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  } catch (err) {
    throw new RecError('not-deflate', `could not start decompression: ${String(err)}`);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_INFLATED) {
        throw new RecError('bad-length', `demo body exceeds ${MAX_INFLATED} bytes`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof RecError) throw err;
    throw new RecError('not-deflate', `not a zlib stream: ${String(err)}`);
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A cursor over the inflated body, refusing to read past its end. */
class HunkReader {
  pos = 0;

  constructor(
    private readonly buf: Uint8Array,
    private readonly view: DataView,
  ) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new RecError('truncated', `wanted ${n} bytes at ${this.pos}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** A fixed-width C string: everything up to the first NUL, latin-1. */
  cstr(n: number): string {
    const raw = this.bytes(n);
    const end = raw.indexOf(0);
    return latin1(end === -1 ? raw : raw.subarray(0, end));
  }

  /** `Playback::read_data`: everything up to a 0xFF, which is consumed. */
  untilTerminator(): Uint8Array {
    const start = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0xff) this.pos++;
    const out = this.buf.subarray(start, this.pos);
    // A stream that ends without its terminator is a truncated file, not an empty one — the
    // original would read it as EOF and play a demo that stops early with no explanation.
    if (this.pos >= this.buf.length) throw new RecError('truncated', 'input stream has no 0xFF terminator');
    this.pos++;
    return out;
  }
}

/**
 * Latin-1, in chunks. The 1998 game wrote bytes, not an encoding, and every byte is a
 * character in latin-1 — so this never fails on a name typed on a French keyboard the way
 * `TextDecoder('utf-8')` would. Chunked because spreading a whole summary into
 * `String.fromCharCode` overflows the argument stack.
 */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return out;
}

/** `Stringtable` over the summary text: one `key value` pair per line. */
function parseSummary(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    if (space === -1) out.set(trimmed, '');
    // Last write wins, as `Dict::add` does — the summary repeats `players/0/score` and the
    // second copy is the one `check_scores` compares against.
    else out.set(trimmed.slice(0, space), trimmed.slice(space + 1));
  }
  return out;
}

/**
 * Parse a `.rec` file. Mirrors `Playback::read_all` — source/recording.cc:224-264.
 *
 * Unknown hunk tags are fatal rather than skipped. The original printed a message and carried
 * on, which it could afford to: it was reading its own files. Here the file is something a
 * stranger handed the page, and a decoder that walks past what it does not understand is one
 * that can be walked past.
 */
export async function parseRec(file: Uint8Array): Promise<RecDemo> {
  if (file.length < 6) throw new RecError('truncated', `${file.length} bytes is not a recording`);

  const declared = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(0, true);
  if (declared > MAX_INFLATED) {
    // Overwhelmingly this is not a `.rec` at all — the first four bytes of some other format read
    // as a nonsense length. Say that, rather than quoting the number back at somebody who has no
    // way to know it came from a header they never wrote.
    throw new RecError(
      'bad-length',
      `it does not begin like a Quadra recording (its header claims ${declared} bytes)`,
    );
  }

  const body = await inflate(file.subarray(4));
  if (body.length !== declared) {
    throw new RecError('bad-length', `header declares ${declared} bytes, body inflated to ${body.length}`);
  }

  const r = new HunkReader(body, new DataView(body.buffer, body.byteOffset, body.byteLength));

  let seed = 0;
  const repeat: [number, number, number] = [2, 2, 2];
  let singlePlayer = 0;
  let input: Uint8Array | null = null;
  let info: RecInfo | undefined;
  let summary: Map<string, string> | undefined;
  let packetFormat = false;
  let gotSeed = false;

  while (r.remaining > 0) {
    const hunk = r.u8();
    switch (hunk) {
      case Hunk.Seed:
        seed = r.i32();
        repeat[0] = r.i32();
        repeat[1] = r.i32();
        repeat[2] = r.i32();
        gotSeed = true;
        break;
      case Hunk.Single:
        singlePlayer = r.u8();
        break;
      case Hunk.Data:
        input = r.untilTerminator();
        break;
      case Hunk.Info:
        info = { name: r.cstr(NAME_BYTES), score: r.i32(), lines: r.i32(), level: r.i32() };
        break;
      case Hunk.Packet: {
        // Walked over rather than decoded: knowing a file is in packet form is all we need, and
        // the protocol layer it would take to play one is a project of its own. Still read to the
        // byte, so the rest of the hunks stay in step and the refusal below is why it fails.
        packetFormat = true;
        r.u32(); // frame
        r.bytes(r.u16());
        break;
      }
      case Hunk.Summary: {
        const size = r.u32();
        summary = parseSummary(r.cstr(size));
        break;
      }
      default:
        throw new RecError('bad-hunk', `unknown hunk ${hunk} at byte ${r.pos - 1}`);
    }
  }

  // `Playback::read_all` calls a demo valid on seed + data + info. The seed and the data are
  // what actually replay it, so those two are required here; `info` is only ever displayed, and
  // 1.0.1-era demos are missing it. A packet-form file carries its seed inside the gameserver
  // packet instead, and is refused below rather than here.
  if (!packetFormat && !gotSeed) {
    throw new RecError('incomplete', 'recording has no seed');
  }

  return {
    seed,
    repeat,
    singlePlayer,
    input: input ?? new Uint8Array(0),
    ...(info ? { info } : {}),
    ...(summary ? { summary } : {}),
    packetFormat,
  };
}

/**
 * Refuse what this port cannot honestly play, with the reason a person can act on.
 *
 * Packet form is the one that will actually come up, and by a wide margin: of the eighteen demos
 * in the upstream distribution, seventeen are in it and only `Buk14clean.rec` is not. Later
 * builds routed every game through the netcode, so this is not a multiplayer-versus-solo split —
 * some of those seventeen are one player alone. The message says so, because telling somebody
 * their single-player recording is "multiplayer" is just wrong, and they would go looking for a
 * mistake they did not make.
 */
export function recRefusal(demo: RecDemo): string | null {
  if (demo.packetFormat) {
    return (
      'That recording is in the netcode packet format later versions used. Only the older ' +
      'single-player .rec form plays here — of the demos shipped with Quadra, that is ' +
      'Buk14clean.rec.'
    );
  }
  if (demo.input.length === 0) {
    return 'That recording has no input in it.';
  }
  return null;
}
