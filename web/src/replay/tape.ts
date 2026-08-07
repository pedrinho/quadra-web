/*
 * The recording format: what a player did, and when the clock ticked.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A tape is a header plus one record per *rendered frame*. Per-frame is exact, not an
 * approximation: Game.advance runs its whole tick loop synchronously inside one animation
 * frame and JS is single-threaded, so no input can arrive between two ticks of a batch.
 * Every host-originated change necessarily lands on a frame boundary.
 *
 * What goes in the body is only (i) what the player pressed and (ii) how the clock advanced.
 * Everything else — the piece stream, garbage, scores — is a deterministic consequence and is
 * recomputed on replay. The moment a consequence is recorded as data, the tape stops being a
 * proof of a score and becomes a claim about one.
 *
 * `encodeFrame`/`decodeFrame` are deliberately usable on their own: the netcode milestone
 * sends exactly these bytes over a socket, one record per frame, and a server that appends
 * what it receives ends up holding a tape it can verify and replay with this same code.
 */

import { ACTION_COUNT, type Action } from '../engine/canvas.js';
import { MAX_ACCUMULATOR_MS, TICK_MS } from '../engine/game.js';
import { SIM_VERSION, TAPE_FORMAT_VERSION } from './version.js';

const MAGIC = 0x51544150; // "QTAP"

/** The most ticks one frame can legitimately run: the accumulator ceiling, in ticks. */
export const MAX_TICKS_PER_FRAME = MAX_ACCUMULATOR_MS / TICK_MS;

export type TapeErrorCode =
  | 'bad-magic'
  | 'bad-format-version'
  | 'sim-version-mismatch'
  | 'truncated'
  | 'bad-opcode'
  | 'bad-groups'
  | 'bad-header'
  | 'bad-frame'
  | 'trailing-bytes'
  | 'checkpoint-mismatch';

export class TapeError extends Error {
  constructor(
    readonly code: TapeErrorCode,
    message: string,
    readonly at?: number,
  ) {
    super(message);
    this.name = 'TapeError';
  }
}

/* --- events ------------------------------------------------------------- */

export const enum EventOp {
  Press = 0,
  Release = 1,
  ClearAll = 2,
  Pause = 3,
  Reconfig = 4,
  Checkpoint = 5,
}

export interface PressEvent {
  op: EventOp.Press | EventOp.Release;
  action: Action;
}
export interface ClearAllEvent {
  op: EventOp.ClearAll;
}
export interface PauseEvent {
  op: EventOp.Pause;
  paused: boolean;
}
/** A mid-game settings change. Sensitivity and the key grouping both feed the simulation. */
export interface ReconfigEvent {
  op: EventOp.Reconfig;
  hSensitivity: number;
  vSensitivity: number;
  continuous: boolean;
  keyGroups: Uint8Array;
}
/** A periodic self-check: what the recorder believed the state was at this frame. */
export interface CheckpointEvent {
  op: EventOp.Checkpoint;
  lanes: [number, number];
  score: number;
}

export type TapeEvent =
  | PressEvent
  | ClearAllEvent
  | PauseEvent
  | ReconfigEvent
  | CheckpointEvent;

/** One rendered frame: what was applied before it, and the schedule it then ran. */
export interface TapeFrame {
  events: TapeEvent[];
  ticks: number;
  jump: number;
}

export interface TapeHeader {
  simVersion: number;
  seed: bigint;
  level: number;
  levelUp: boolean;
  shadow: boolean;
  continuous: boolean;
  hSensitivity: number;
  vSensitivity: number;
  keyGroups: Uint8Array;
  /** Wall-clock start, milliseconds since the epoch. Metadata; the simulation never reads it. */
  startedAt: number;
}

export interface Tape {
  header: TapeHeader;
  frames: TapeFrame[];
}

/* --- byte plumbing ------------------------------------------------------- */

export class ByteWriter {
  private buf = new Uint8Array(1024);
  private len = 0;

  private room(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): void {
    this.room(1);
    this.buf[this.len++] = v & 0xff;
  }

  u16(v: number): void {
    this.u8(v);
    this.u8(v >>> 8);
  }

  u32(v: number): void {
    this.u8(v);
    this.u8(v >>> 8);
    this.u8(v >>> 16);
    this.u8(v >>> 24);
  }

  u64(v: bigint): void {
    const u = BigInt.asUintN(64, v);
    this.u32(Number(u & 0xffffffffn));
    this.u32(Number((u >> 32n) & 0xffffffffn));
  }

  /** LEB128. Non-negative integers only — every count in this format is one. */
  varint(v: number): void {
    if (!Number.isInteger(v) || v < 0) throw new TapeError('bad-frame', `varint: ${v}`);
    // `% 128` rather than `& 0x7f`: bitwise operators coerce to int32, which would corrupt
    // any value above 2^31 — and these are counts, which can legitimately get large.
    let n = v;
    while (n >= 0x80) {
      this.u8((n % 128) | 0x80);
      n = Math.floor(n / 128);
    }
    this.u8(n);
  }

  bytes(src: Uint8Array): void {
    this.room(src.length);
    this.buf.set(src, this.len);
    this.len += src.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }

  get length(): number {
    return this.len;
  }
}

export class ByteReader {
  pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new TapeError('truncated', `wanted ${n} bytes at ${this.pos}`, this.pos);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>> 0;
  }

  u64(): bigint {
    const lo = BigInt(this.u32());
    const hi = BigInt(this.u32());
    return BigInt.asIntN(64, (hi << 32n) | lo);
  }

  varint(): number {
    let result = 0;
    let shift = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      result += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) {
          throw new TapeError('bad-frame', `varint out of range at ${this.pos}`, this.pos);
        }
        return result;
      }
      shift *= 128;
    }
    throw new TapeError('bad-frame', `varint too long at ${this.pos}`, this.pos);
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/* --- key groups ---------------------------------------------------------- */

/**
 * A grouping is canonical when every action points at the lowest action sharing its key:
 * `g[i] <= i` and `g[g[i]] === g[i]`. That is exactly what `groupsFromBindings` produces, and
 * checking it is the whole of validating a grouping — no key codes are involved, so there is
 * nothing to trust. A hostile grouping can only *cost* the player actions (two sharing one
 * sticky slot lose independence), so it is not an advantage to forge.
 */
export function isCanonicalKeyGroups(g: ArrayLike<number>): boolean {
  if (g.length !== ACTION_COUNT) return false;
  for (let i = 0; i < ACTION_COUNT; i++) {
    const gi = g[i]!;
    if (!Number.isInteger(gi) || gi < 0 || gi > i) return false;
    if (g[gi] !== gi) return false;
  }
  return true;
}

/* --- frame records ------------------------------------------------------- */

const TICKS_ESCAPE = 31;
const HAS_EVENTS = 1 << 5;
const HAS_JUMP = 1 << 6;
const HAS_RUN = 1 << 7;

function writeEvent(w: ByteWriter, e: TapeEvent): void {
  switch (e.op) {
    case EventOp.Press:
    case EventOp.Release:
      if (e.action < 0 || e.action >= ACTION_COUNT) {
        throw new TapeError('bad-frame', `action out of range: ${e.action}`);
      }
      w.u8((e.op << 4) | e.action);
      return;
    case EventOp.ClearAll:
      w.u8(EventOp.ClearAll << 4);
      return;
    case EventOp.Pause:
      w.u8((EventOp.Pause << 4) | (e.paused ? 1 : 0));
      return;
    case EventOp.Reconfig:
      w.u8(EventOp.Reconfig << 4);
      w.u8(e.hSensitivity);
      w.u8(e.vSensitivity);
      w.u8(e.continuous ? 1 : 0);
      w.bytes(e.keyGroups);
      return;
    case EventOp.Checkpoint:
      w.u8(EventOp.Checkpoint << 4);
      w.u32(e.lanes[0]);
      w.u32(e.lanes[1]);
      w.varint(e.score);
      return;
  }
}

function readEvent(r: ByteReader): TapeEvent {
  const at = r.pos;
  const b = r.u8();
  const op = b >>> 4;
  const payload = b & 0x0f;
  switch (op) {
    case EventOp.Press:
    case EventOp.Release:
      if (payload >= ACTION_COUNT) {
        throw new TapeError('bad-opcode', `action out of range: ${payload}`, at);
      }
      return { op: op as EventOp.Press | EventOp.Release, action: payload as Action };
    case EventOp.ClearAll:
      return { op: EventOp.ClearAll };
    case EventOp.Pause:
      return { op: EventOp.Pause, paused: payload === 1 };
    case EventOp.Reconfig: {
      const hSensitivity = r.u8();
      const vSensitivity = r.u8();
      const continuous = r.u8() === 1;
      const keyGroups = r.bytes(ACTION_COUNT);
      if (!isCanonicalKeyGroups(keyGroups)) {
        throw new TapeError('bad-groups', 'non-canonical key grouping', at);
      }
      return { op: EventOp.Reconfig, hSensitivity, vSensitivity, continuous, keyGroups };
    }
    case EventOp.Checkpoint: {
      const lanes: [number, number] = [r.u32(), r.u32()];
      return { op: EventOp.Checkpoint, lanes, score: r.varint() };
    }
    default:
      // Never skip what we do not understand: a newer client could otherwise smuggle state
      // past an older verifier and have it agree to a score it did not actually simulate.
      throw new TapeError('bad-opcode', `unknown event op ${op}`, at);
  }
}

/**
 * One frame record. `run` is how many *additional* identical frames follow — the compression
 * that makes an idle 60 fps minute cost tens of bytes rather than thousands. Only frames with
 * no events and no jump may be run-length encoded.
 */
export function encodeFrame(w: ByteWriter, f: TapeFrame, run = 0): void {
  if (f.ticks < 0 || !Number.isInteger(f.ticks)) {
    throw new TapeError('bad-frame', `ticks: ${f.ticks}`);
  }
  if (run > 0 && (f.events.length > 0 || f.jump > 0)) {
    throw new TapeError('bad-frame', 'run-length is only valid for a bare frame');
  }
  const escaped = f.ticks >= TICKS_ESCAPE;
  let control = escaped ? TICKS_ESCAPE : f.ticks;
  if (f.events.length > 0) control |= HAS_EVENTS;
  if (f.jump > 0) control |= HAS_JUMP;
  if (run > 0) control |= HAS_RUN;
  w.u8(control);
  if (escaped) w.varint(f.ticks);
  if (run > 0) w.varint(run);
  if (f.events.length > 0) {
    w.varint(f.events.length);
    for (const e of f.events) writeEvent(w, e);
  }
  if (f.jump > 0) w.varint(f.jump);
}

/** Decodes one record. Returns the frame and how many extra repeats follow it. */
export function decodeFrame(r: ByteReader): { frame: TapeFrame; run: number } {
  const control = r.u8();
  const rawTicks = control & 0x1f;
  const ticks = rawTicks === TICKS_ESCAPE ? r.varint() : rawTicks;
  const run = control & HAS_RUN ? r.varint() : 0;
  const events: TapeEvent[] = [];
  if (control & HAS_EVENTS) {
    const count = r.varint();
    for (let i = 0; i < count; i++) events.push(readEvent(r));
  }
  const jump = control & HAS_JUMP ? r.varint() : 0;
  return { frame: { events, ticks, jump }, run };
}

/* --- the file container -------------------------------------------------- */

function writeHeader(w: ByteWriter, h: TapeHeader, frames: number, ticks: number): void {
  if (!isCanonicalKeyGroups(h.keyGroups)) {
    throw new TapeError('bad-groups', 'non-canonical key grouping');
  }
  w.u32(MAGIC);
  w.u8(TAPE_FORMAT_VERSION);
  w.u16(h.simVersion);
  w.u64(h.seed);
  w.u8(h.level);
  w.u8((h.levelUp ? 1 : 0) | (h.shadow ? 2 : 0) | (h.continuous ? 4 : 0));
  w.u8(h.hSensitivity);
  w.u8(h.vSensitivity);
  w.bytes(h.keyGroups);
  w.varint(Math.max(0, Math.floor(h.startedAt)));
  // Declared up front so a verifier can refuse an over-budget tape without simulating a
  // single frame. They are claims: the decoder checks the body against them.
  w.varint(frames);
  w.varint(ticks);
}

/**
 * The header on its own, for a recorder that encodes each frame as it happens and only knows
 * the totals when the game ends. A tape is then literally `encodeHeader(...)` followed by the
 * concatenated frame records — the same property the netcode milestone depends on.
 */
export function encodeHeader(header: TapeHeader, frames: number, ticks: number): Uint8Array {
  const w = new ByteWriter();
  writeHeader(w, header, frames, ticks);
  return w.finish();
}

export interface DecodedHeader {
  header: TapeHeader;
  declaredFrames: number;
  declaredTicks: number;
}

export function decodeHeader(r: ByteReader): DecodedHeader {
  const magic = r.u32();
  if (magic !== MAGIC) throw new TapeError('bad-magic', 'not a Quadra tape', 0);
  const format = r.u8();
  if (format !== TAPE_FORMAT_VERSION) {
    throw new TapeError('bad-format-version', `tape format ${format}`, 4);
  }
  const simVersion = r.u16();
  const seed = r.u64();
  const level = r.u8();
  const flags = r.u8();
  const hSensitivity = r.u8();
  const vSensitivity = r.u8();
  const keyGroups = r.bytes(ACTION_COUNT);
  if (!isCanonicalKeyGroups(keyGroups)) {
    throw new TapeError('bad-groups', 'non-canonical key grouping in header');
  }
  if (level < 1) throw new TapeError('bad-header', `level ${level}`);
  if (hSensitivity > 100 || vSensitivity > 100) {
    throw new TapeError('bad-header', 'sensitivity out of range');
  }
  const startedAt = r.varint();
  return {
    header: {
      simVersion,
      seed,
      level,
      levelUp: (flags & 1) !== 0,
      shadow: (flags & 2) !== 0,
      continuous: (flags & 4) !== 0,
      hSensitivity,
      vSensitivity,
      keyGroups,
      startedAt,
    },
    declaredFrames: r.varint(),
    declaredTicks: r.varint(),
  };
}

/**
 * Encode a whole tape. Canonical: run-lengths are always maximal, so re-encoding a decoded
 * tape reproduces the same bytes. That matters the moment tapes are hashed or deduplicated.
 */
export function encodeTape(tape: Tape): Uint8Array {
  const w = new ByteWriter();
  let ticks = 0;
  for (const f of tape.frames) ticks += f.ticks;
  writeHeader(w, tape.header, tape.frames.length, ticks);
  const frames = tape.frames;
  for (let i = 0; i < frames.length; ) {
    const f = frames[i]!;
    let run = 0;
    if (f.events.length === 0 && f.jump === 0) {
      while (
        i + run + 1 < frames.length &&
        frames[i + run + 1]!.ticks === f.ticks &&
        frames[i + run + 1]!.events.length === 0 &&
        frames[i + run + 1]!.jump === 0
      ) {
        run++;
      }
    }
    encodeFrame(w, f, run);
    i += run + 1;
  }
  return w.finish();
}

/**
 * Ceiling on frames a decoder will materialise: roughly 90 minutes at 60 fps.
 *
 * This is not politeness, it is the one place run-length encoding bites back. A hostile tape
 * can declare 10^15 frames and a 10^15 run in a handful of bytes; without a cap the decoder
 * would sit in a push loop forever on input it had barely read.
 */
export const DEFAULT_MAX_FRAMES = 400_000;

export function decodeTape(bytes: Uint8Array, maxFrames = DEFAULT_MAX_FRAMES): Tape {
  const r = new ByteReader(bytes);
  const { header, declaredFrames, declaredTicks } = decodeHeader(r);
  if (declaredFrames > maxFrames) {
    throw new TapeError('bad-header', `declares ${declaredFrames} frames, limit is ${maxFrames}`);
  }
  const frames: TapeFrame[] = [];
  let ticks = 0;
  while (frames.length < declaredFrames) {
    const { frame, run } = decodeFrame(r);
    const total = run + 1;
    if (frames.length + total > declaredFrames) {
      throw new TapeError('bad-frame', 'run overruns the declared frame count', r.pos);
    }
    frames.push(frame);
    ticks += frame.ticks;
    for (let i = 0; i < run; i++) {
      frames.push({ events: [], ticks: frame.ticks, jump: 0 });
      ticks += frame.ticks;
    }
  }
  if (ticks !== declaredTicks) {
    throw new TapeError('bad-header', `declared ${declaredTicks} ticks, body has ${ticks}`);
  }
  if (r.remaining > 0) {
    throw new TapeError('trailing-bytes', `${r.remaining} bytes after the last frame`, r.pos);
  }
  return { header, frames };
}

/** Refuse a recording made by a different simulation rather than replaying it into a lie. */
export function checkSimVersion(header: TapeHeader): void {
  if (header.simVersion !== SIM_VERSION) {
    throw new TapeError(
      'sim-version-mismatch',
      `tape was recorded on sim version ${header.simVersion}, this build is ${SIM_VERSION}`,
    );
  }
}
