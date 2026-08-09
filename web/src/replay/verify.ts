/*
 * Deciding whether a recording is a game that was actually played.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * This is the function a server runs on a submitted score, so it is written for input that is
 * assumed hostile:
 *
 *  - **It never throws.** Every outcome, including a corrupt tape, a tape from another engine
 *    and a tape that is not a tape, comes back as a result with a code and an offset. A
 *    verifier that throws is a verifier whose caller has to guess what happened.
 *  - **It bounds its own work before doing any.** The header declares the frame and tick
 *    totals, so a tape that would cost too much is refused without simulating a single frame.
 *    The per-frame tick ceiling is free and exact: it is the accumulator ceiling `advance`
 *    itself can never exceed.
 *  - **It decodes as it goes.** Frames stream off the bytes, so a megabyte of tape costs
 *    constant memory rather than a million frame objects.
 *
 * What it proves is narrow and worth stating plainly: that this input sequence, on this seed,
 * produces this score. Not that a human produced the input. Server-issued seeds and rate
 * limits are what make the sequence expensive to shop for; see the milestone plan.
 */

import { TICK_MS } from '../engine/game.js';
import { boardHash, stateHash } from './hash.js';
import { applyEvent, gameFromHeader } from './playback.js';
import {
  ByteReader,
  MAX_TICKS_PER_FRAME,
  TapeError,
  decodeHeader,
  streamFrames,
  type TapeErrorCode,
  type TapeHeader,
} from './tape.js';

export type VerifyErrorCode =
  | TapeErrorCode
  | 'limit-bytes'
  | 'limit-frames'
  | 'limit-ticks'
  | 'limit-ticks-per-frame'
  | 'limit-jump'
  /** Something threw that is not a TapeError. A bug here, not in the tape. */
  | 'internal';

export interface VerifyLimits {
  /** Refused before a byte is parsed. Ten minutes of dense play is around 45 KB. */
  maxBytes: number;
  /** Roughly 90 minutes at 60 fps. */
  maxFrames: number;
  /** Ten thousand seconds of simulated time. */
  maxTicks: number;
  /**
   * The accumulator ceiling in ticks. This is what `Game.advance` can produce at most, so it
   * costs nothing to enforce and no honest tape can trip it — and it is what stops a single
   * frame record from claiming a million ticks.
   */
  maxTicksPerFrame: number;
  /** Total clock skipped past stalls, in milliseconds. A day of it is not a game. */
  maxJumpTotal: number;
}

export const DEFAULT_LIMITS: VerifyLimits = {
  maxBytes: 1024 * 1024,
  maxFrames: 400_000,
  maxTicks: 1_000_000,
  maxTicksPerFrame: MAX_TICKS_PER_FRAME,
  maxJumpTotal: 86_400_000,
};

/** What the tape turned out to be worth. The score here is the only one anyone should store. */
export interface VerifyOk {
  ok: true;
  header: TapeHeader;
  frames: number;
  ticks: number;
  /** Simulated time, milliseconds. Not wall-clock: a stall skips the clock without ticks. */
  simulatedMs: number;
  /**
   * Ticks the game spent paused.
   *
   * Pausing does not stop the frame counter (`env.paused` gates input, not the clock), so paused
   * time is real time the player had to think in — free, and unlimited, unless something counts
   * it. Nothing in the simulation reads this; it exists so that whoever ranks a run can decide
   * how much of it to allow.
   */
  pausedTicks: number;
  score: number;
  lines: number;
  level: number;
  /** Whether the run ended in a top-out, as opposed to the tape simply stopping. */
  over: boolean;
  boardHash: string;
  stateHash: string;
}

export interface VerifyFailure {
  ok: false;
  code: VerifyErrorCode;
  message: string;
  /** Byte offset, where the failure was in the encoding. */
  at?: number;
  /** Frames simulated before the failure. Zero means nothing was simulated at all. */
  frame: number;
}

export type VerifyResult = VerifyOk | VerifyFailure;

export interface VerifyOptions {
  limits?: Partial<VerifyLimits>;
  /**
   * Draw the ghost piece while verifying. Off by default and purely a saving: the ghost is
   * not simulation-visible, which `test/recorder.test.ts` pins.
   */
  shadow?: boolean;
}

export function verify(bytes: Uint8Array, opts: VerifyOptions = {}): VerifyResult {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  let frame = 0;
  try {
    if (bytes.length > limits.maxBytes) {
      return fail('limit-bytes', `${bytes.length} bytes, limit is ${limits.maxBytes}`, 0, 0);
    }

    const reader = new ByteReader(bytes);
    const { header, declaredFrames, declaredTicks } = decodeHeader(reader);
    // Both totals are declared up front precisely so this costs nothing. A tape that would be
    // too expensive to check is refused here, having simulated nothing.
    if (declaredFrames > limits.maxFrames) {
      return fail('limit-frames', `declares ${declaredFrames} frames`, reader.pos, 0);
    }
    if (declaredTicks > limits.maxTicks) {
      return fail('limit-ticks', `declares ${declaredTicks} ticks`, reader.pos, 0);
    }

    const game = gameFromHeader(header, { shadow: opts.shadow ?? false });
    let ticks = 0;
    let jumpTotal = 0;
    let pausedTicks = 0;

    for (const record of streamFrames(reader, declaredFrames)) {
      if (record.ticks > limits.maxTicksPerFrame) {
        return fail('limit-ticks-per-frame', `frame claims ${record.ticks} ticks`, reader.pos, frame);
      }
      ticks += record.ticks;
      if (ticks > limits.maxTicks) {
        return fail('limit-ticks', `over ${limits.maxTicks} ticks`, reader.pos, frame);
      }
      jumpTotal += record.jump;
      if (jumpTotal > limits.maxJumpTotal) {
        return fail('limit-jump', `${jumpTotal} ms of skipped clock`, reader.pos, frame);
      }
      for (const event of record.events) applyEvent(game, event, frame);
      // After the events and before the ticks, which is exactly the state those ticks run in.
      if (game.paused) pausedTicks += record.ticks;
      game.stepFrame(record.ticks, record.jump);
      // Both queues are outputs nobody is listening to here, and they would otherwise grow
      // for every tick of the run.
      game.drainSounds();
      game.drainNotices();
      frame++;
    }

    if (ticks !== declaredTicks) {
      return fail('bad-header', `declared ${declaredTicks} ticks, body has ${ticks}`, reader.pos, frame);
    }
    if (reader.remaining > 0) {
      return fail('trailing-bytes', `${reader.remaining} bytes after the last frame`, reader.pos, frame);
    }

    return {
      ok: true,
      header,
      frames: frame,
      ticks,
      simulatedMs: ticks * TICK_MS,
      pausedTicks,
      score: game.canvas.score,
      lines: game.canvas.linesTot,
      level: game.canvas.level,
      over: game.isOver,
      boardHash: boardHash(game.canvas),
      stateHash: stateHash(game),
    };
  } catch (err) {
    if (err instanceof TapeError) {
      return {
        ok: false,
        code: err.code,
        message: err.message,
        frame,
        ...(err.at === undefined ? {} : { at: err.at }),
      };
    }
    return { ok: false, code: 'internal', message: String(err), frame };
  }
}

const fail = (
  code: VerifyErrorCode,
  message: string,
  at: number,
  frame: number,
): VerifyFailure => ({ ok: false, code, message, at, frame });
