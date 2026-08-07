/*
 * Replaying a tape back into a game.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A replay is a re-simulation, not a movie: the tape carries only what the player did and how
 * the clock advanced, and the pieces, the cascades and the score are computed again from the
 * seed. So a replay that reaches a different score has not "played back wrong" — it has proved
 * the two engines are not the same engine, which is the property the leaderboard rests on.
 *
 * Seeking is therefore re-simulation from frame 0. At these tick counts that is milliseconds,
 * and it keeps the viewer honest: there is no way to show a frame that the simulation cannot
 * actually reach.
 */

import { Game } from '../engine/game.js';
import { stateLanes } from './hash.js';
import {
  EventOp,
  TapeError,
  checkSimVersion,
  type Tape,
  type TapeEvent,
  type TapeHeader,
} from './tape.js';

export interface PlaybackOptions {
  /**
   * Draw the ghost piece. Off saves work in a verifier that renders nothing; it cannot change
   * the outcome, which `test/recorder.test.ts` pins. Defaults to whatever was recorded.
   */
  shadow?: boolean;
  /** Stop at the first checkpoint that disagrees. On by default — a replay that ignores its
   *  own checkpoints is just a slower way of getting the wrong answer. */
  checkpoints?: boolean;
}

/** Rebuild the game a tape was recorded from, at frame zero. */
export function gameFromHeader(header: TapeHeader, opts: PlaybackOptions = {}): Game {
  checkSimVersion(header);
  return new Game({
    seed: header.seed,
    level: header.level,
    levelUp: header.levelUp,
    shadow: opts.shadow ?? header.shadow,
    hSensitivity: header.hSensitivity,
    vSensitivity: header.vSensitivity,
    continuous: header.continuous,
    keyGroups: header.keyGroups,
  });
}

/**
 * A tape driving a game, one frame at a time.
 *
 * Every event is applied through the same `Game` methods a live host calls, and every frame
 * runs through the same `stepFrame` the wall clock drives, so there is no replay-only path
 * that could quietly behave differently from play.
 */
export class TapePlayer {
  game: Game;
  /** Frames played so far, which is also the index of the next one. */
  index = 0;

  constructor(
    readonly tape: Tape,
    private readonly opts: PlaybackOptions = {},
  ) {
    this.game = gameFromHeader(tape.header, opts);
  }

  get length(): number {
    return this.tape.frames.length;
  }

  get done(): boolean {
    return this.index >= this.tape.frames.length;
  }

  /** Play one frame. Returns false at the end of the tape. */
  step(): boolean {
    const frame = this.tape.frames[this.index];
    if (!frame) return false;
    for (const event of frame.events) this.apply(event);
    this.game.stepFrame(frame.ticks, frame.jump);
    this.index++;
    return true;
  }

  /** Play to the end, or until `stop` says so. Returns the frame it stopped on. */
  run(stop?: (game: Game, index: number) => boolean): number {
    while (!this.done) {
      if (stop?.(this.game, this.index)) break;
      this.step();
    }
    return this.index;
  }

  /** Wind to an absolute frame, re-simulating from the start when going backwards. */
  seek(frame: number): void {
    const target = Math.max(0, Math.min(frame, this.tape.frames.length));
    if (target < this.index) {
      this.game = gameFromHeader(this.tape.header, this.opts);
      this.index = 0;
    }
    while (this.index < target) this.step();
  }

  private apply(event: TapeEvent): void {
    switch (event.op) {
      case EventOp.Press:
        this.game.input(event.action, true);
        return;
      case EventOp.Release:
        this.game.input(event.action, false);
        return;
      case EventOp.ClearAll:
        this.game.clearKeys();
        return;
      case EventOp.Pause:
        this.game.setPaused(event.paused);
        return;
      case EventOp.Reconfig:
        // `reconfigure`, not `setKeyGroups`: the clear that a live rebind performs was recorded
        // as its own ClearAll, and doing it twice would wipe a key pressed in between.
        this.game.reconfigure(
          event.hSensitivity,
          event.vSensitivity,
          event.continuous,
          event.keyGroups,
        );
        return;
      case EventOp.Checkpoint: {
        if (this.opts.checkpoints === false) return;
        const lanes = stateLanes(this.game);
        if (lanes[0] !== event.lanes[0] || lanes[1] !== event.lanes[1]) {
          throw new TapeError(
            'checkpoint-mismatch',
            `frame ${this.index}: recorded state ${hex(event.lanes)} (score ${event.score}), ` +
              `replay reached ${hex(lanes)} (score ${this.game.canvas.score})`,
          );
        }
        return;
      }
    }
  }
}

const hex = (lanes: readonly [number, number]): string =>
  lanes[0].toString(16).padStart(8, '0') + lanes[1].toString(16).padStart(8, '0');

/** Replay a whole tape and hand back the finished game. */
export function replay(tape: Tape, opts: PlaybackOptions = {}): Game {
  const player = new TapePlayer(tape, opts);
  player.run();
  return player.game;
}
