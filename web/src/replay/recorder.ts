/*
 * Recording a live game onto a tape.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The recorder sits on `Game`'s input seam and writes bytes as the game is played, rather than
 * building a list of frames and encoding it at the end. Two reasons: a permanently-on recorder
 * then costs kilobytes of memory instead of megabytes of objects, and the bytes for a frame
 * exist the moment the frame does — which is exactly what the netcode milestone needs to put
 * on a socket.
 *
 * It records only what the host did and how the clock advanced. Everything else is a
 * consequence and is recomputed on replay.
 */

import { ACTION_COUNT, PRESSED, RELEASED, type Action } from '../engine/canvas.js';
import type { FrameStep, Game, GameRecorder } from '../engine/game.js';
import { stateLanes } from './hash.js';
import {
  ByteWriter,
  EventOp,
  decodeTape,
  encodeFrame,
  encodeHeader,
  type Tape,
  type TapeEvent,
  type TapeFrame,
  type TapeHeader,
} from './tape.js';
import { SIM_VERSION } from './version.js';

/**
 * Frames between checkpoints. ~12 bytes every 30 seconds of play, and what it buys is a
 * divergence reported at the frame it happened rather than as a wrong score at the end.
 */
export const DEFAULT_CHECKPOINT_INTERVAL = 3000;

export interface RecorderOptions {
  /** Wall-clock start. Metadata only — the simulation never reads it. */
  startedAt?: number;
  /** Frames between checkpoints. 0 records none. */
  checkpointInterval?: number;
  /**
   * Throw if the simulation's key state moved by any route other than the recorded one.
   * Cheap (a seven-byte compare per frame) and the only thing that catches the next direct
   * `canvas.pressKey` someone adds to the host, so leave it on wherever a throw is survivable.
   */
  guard?: boolean;
}

export class RecorderBypassError extends Error {
  constructor(
    readonly frame: number,
    readonly keys: Uint8Array,
    readonly expected: Uint8Array,
  ) {
    super(
      `key state changed outside Game's input seam at frame ${frame}: ` +
        `saw [${Array.from(keys).join(',')}], recorded [${Array.from(expected).join(',')}]`,
    );
    this.name = 'RecorderBypassError';
  }
}

export class TapeRecorder implements GameRecorder {
  private readonly header: TapeHeader;
  private readonly body = new ByteWriter();
  private readonly checkpointInterval: number;
  private readonly guard: boolean;

  /** Host events since the last frame. They belong to the frame that is about to run. */
  private pending: TapeEvent[] = [];
  /** An un-emitted bare frame and how many identical ones follow it. See `commit`. */
  private run: { ticks: number; repeats: number } | null = null;
  private frames = 0;
  private ticks = 0;

  /** What the sticky key state should be, if nothing bypassed the seam. */
  private readonly shadow = new Uint8Array(ACTION_COUNT);
  private groups: Uint8Array;

  constructor(
    private readonly game: Game,
    opts: RecorderOptions = {},
  ) {
    const {
      startedAt = Date.now(),
      checkpointInterval = DEFAULT_CHECKPOINT_INTERVAL,
      guard = true,
    } = opts;
    // A tape always claims to start at frame zero. Attaching to a game already in progress
    // would produce one that decodes, verifies and describes a game nobody played.
    if (game.frame !== 0 || game.ticks !== 0) {
      throw new Error(`cannot record a game already at frame ${game.frame}`);
    }
    this.checkpointInterval = checkpointInterval;
    this.guard = guard;
    this.groups = game.start.keyGroups;
    this.header = {
      simVersion: SIM_VERSION,
      seed: game.start.seed,
      level: game.start.level,
      levelUp: game.start.levelUp,
      shadow: game.start.shadow,
      continuous: game.start.continuous,
      hSensitivity: game.start.hSensitivity,
      vSensitivity: game.start.vSensitivity,
      keyGroups: game.start.keyGroups,
      startedAt,
    };
  }

  /* --- the seam ------------------------------------------------------------ */

  input(action: Action, down: boolean): void {
    this.pending.push({ op: down ? EventOp.Press : EventOp.Release, action });
    const slot = this.groups[action] ?? action;
    if (down) this.shadow[slot]! |= PRESSED;
    else this.shadow[slot] = RELEASED;
  }

  paused(on: boolean): void {
    this.pending.push({ op: EventOp.Pause, paused: on });
  }

  reconfigured(
    hSensitivity: number,
    vSensitivity: number,
    continuous: boolean,
    keyGroups: Uint8Array,
  ): void {
    this.groups = keyGroups;
    this.pending.push({
      op: EventOp.Reconfig,
      hSensitivity,
      vSensitivity,
      continuous,
      keyGroups,
    });
  }

  keysCleared(): void {
    this.pending.push({ op: EventOp.ClearAll });
    this.shadow.fill(0);
  }

  frame(step: FrameStep): void {
    const keys = this.game.canvas.keys;
    if (this.guard) {
      for (let i = 0; i < ACTION_COUNT; i++) {
        if (keys[i] !== this.shadow[i]) {
          throw new RecorderBypassError(this.frames, Uint8Array.from(keys), Uint8Array.from(this.shadow));
        }
      }
    }
    if (this.checkpointInterval > 0 && this.frames % this.checkpointInterval === 0) {
      // Sampled here, with the frame's events applied and its ticks not yet run, because that
      // is where a replay applies them too. A checkpoint anywhere else is a claim about a
      // moment the replay never passes through.
      this.pending.push({
        op: EventOp.Checkpoint,
        lanes: stateLanes(this.game),
        score: this.game.canvas.score,
      });
    }
    this.commit({ events: this.pending, ticks: step.ticks, jump: step.jump });
    this.pending = [];
  }

  settled(): void {
    // The ticks are allowed to move key state — auto-repeat unreleases, a new piece clears the
    // soft-drop key. Those are consequences of the tape, not input, so the shadow follows them
    // rather than recording them.
    this.shadow.set(this.game.canvas.keys);
  }

  /* --- the bytes ----------------------------------------------------------- */

  /**
   * Emit a frame, collapsing consecutive identical bare ones into a run. Held back by one
   * record, since a run cannot be written until the frame that ends it turns up.
   */
  private commit(f: TapeFrame): void {
    this.frames++;
    this.ticks += f.ticks;
    if (f.events.length === 0 && f.jump === 0) {
      if (this.run && this.run.ticks === f.ticks) {
        this.run.repeats++;
        return;
      }
      this.flushRun();
      this.run = { ticks: f.ticks, repeats: 0 };
      return;
    }
    this.flushRun();
    encodeFrame(this.body, f);
  }

  private flushRun(): void {
    if (!this.run) return;
    encodeFrame(this.body, { events: [], ticks: this.run.ticks, jump: 0 }, this.run.repeats);
    this.run = null;
  }

  get frameCount(): number {
    return this.frames;
  }

  get tickCount(): number {
    return this.ticks;
  }

  /**
   * The tape so far. Non-destructive, so it can be called mid-game — for a size readout, or to
   * ship a prefix — and recording carries on afterwards.
   */
  bytes(): Uint8Array {
    const tail = new ByteWriter();
    if (this.run) {
      encodeFrame(tail, { events: [], ticks: this.run.ticks, jump: 0 }, this.run.repeats);
    }
    const head = encodeHeader(this.header, this.frames, this.ticks);
    const body = this.body.finish();
    const tailBytes = tail.finish();
    const out = new Uint8Array(head.length + body.length + tailBytes.length);
    out.set(head, 0);
    out.set(body, head.length);
    out.set(tailBytes, head.length + body.length);
    return out;
  }

  /** The decoded form, for tests and viewers. Goes through the bytes deliberately: there is
   *  only one encoding of a recording, and this is not a second one. */
  tape(): Tape {
    return decodeTape(this.bytes());
  }
}

/** Record a game from wherever it currently is. Attach before the first frame. */
export function record(game: Game, opts: RecorderOptions = {}): TapeRecorder {
  const recorder = new TapeRecorder(game, opts);
  game.attachRecorder(recorder);
  return recorder;
}
