/*
 * Replaying a 1998 `.rec` demo through this engine.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The counterpart of `playback.ts`, and deliberately the same shape: a demo is re-simulated from
 * its seed, not played back as a movie, so a `.rec` that reaches the score written in its own
 * trailer is a statement about this engine rather than about the file.
 *
 * What differs from a tape is only the clock and the input. A tape records how many 10 ms ticks
 * each rendered frame ran, because a browser's frames are whatever the machine managed that
 * second; a `.rec` has no such notion — the 1998 game ran its simulation one tick per frame and
 * the demo is a flat list of moves, one per frame in which a piece was falling. So a frame here
 * is exactly one tick, always.
 */

import { Game } from '../engine/game.js';
import { OLD_MODE_NET_VERSION } from '../engine/net-version.js';
import type { DemoInput } from '../engine/player.js';
import { SENSITIVITY_PRESETS, DEFAULT_SENSITIVITY } from '../engine/sensitivity.js';
import type { RecDemo } from './rec.js';

/**
 * A cursor over the recorded input — `Playback::get_byte`, source/recording.cc:184-196.
 *
 * Returns 0 past the end, as the original does, and remembers that it did. Running out is not an
 * error: a demo of a game that ended in a top-out has bytes for exactly as many frames as the
 * player was alive for, and the recording simply stops.
 */
class RecInputCursor implements DemoInput {
  at = 0;
  spent = false;

  constructor(private readonly bytes: Uint8Array) {}

  nextByte(): number {
    if (this.at >= this.bytes.length) {
      this.spent = true;
      return 0;
    }
    return this.bytes[this.at++]!;
  }
}

/**
 * Repeat speed 0-3 onto this port's percentage sensitivity.
 *
 * Exact, not approximate: `SENSITIVITY_PRESETS` is the same four settings the original's dropdown
 * offered, and `delayFromPercent` maps each back to the frame delay `Canvas::reinit`'s switch
 * produced. So a demo recorded on "Faster" replays at "Faster".
 */
export function percentFromRepeat(repeat: number): number {
  return SENSITIVITY_PRESETS[repeat]?.pct ?? DEFAULT_SENSITIVITY;
}

/**
 * Build the game a demo was recorded from, at frame zero.
 *
 * The settings are not the player's — they are `Playback`'s. `Canvas::reinit` (source/canvas.cc:
 * 193-200) takes the repeat speed from the recording and forces `continuous` on, and
 * `Playback::create_game` builds a `PRESET_SINGLE` game, which is level 1 with level-up enabled
 * (source/game.cc:290-294). Anything read from this port's own settings instead would replay a
 * different game.
 */
export function gameFromRec(demo: RecDemo, input: DemoInput, shadow = false): Game {
  const pct = percentFromRepeat(demo.repeat[0]);
  return new Game({
    // int32 widened the way `Random::set_seed(time_t)` widens it.
    seed: BigInt(demo.seed),
    level: 1,
    levelUp: true,
    // Cosmetic only — the ghost piece is drawn, never collided against.
    shadow,
    hSensitivity: pct,
    vSensitivity: pct,
    continuous: true,
    netVersion: OLD_MODE_NET_VERSION,
    demo: input,
  });
}

/**
 * A `.rec` driving a game, one frame at a time.
 *
 * Structurally interchangeable with `TapePlayer` — same members, same meanings — so the viewer
 * drives either without knowing which it has. See `ReplaySource` in ui/replay-viewer.ts.
 */
export class RecPlayer {
  game: Game;
  /** Frames played so far, which is also the index of the next one. */
  index = 0;

  private cursor: RecInputCursor;
  private frames: number;

  constructor(
    readonly demo: RecDemo,
    private readonly shadow = false,
  ) {
    this.cursor = new RecInputCursor(demo.input);
    this.game = gameFromRec(demo, this.cursor, shadow);
    // Measured, not guessed. Frames and input bytes are not the same count — a byte is consumed
    // only on a frame where a piece is falling, so `Buk14clean` spends 21503 bytes over 27832
    // frames — and there is no honest way to know the total short of running it. A whole demo is
    // a few milliseconds of engine work, and the scrubber needs a real length. The ghost piece
    // is not passed on: it is drawn and never collided against, so it cannot change the count.
    this.frames = playRec(demo).frames;
  }

  get length(): number {
    return this.frames;
  }

  get done(): boolean {
    return this.index >= this.frames;
  }

  /** How many 10 ms ticks the frame at `index` runs. Always one; see the header. */
  ticksAt(_index: number): number {
    return 1;
  }

  /** Play one frame. Returns false at the end of the demo. */
  step(): boolean {
    if (this.done) return false;
    this.game.stepFrame(1);
    this.index++;
    return true;
  }

  /** Wind to an absolute frame, re-simulating from the start when going backwards. */
  seek(frame: number): void {
    const target = Math.max(0, Math.min(frame, this.frames));
    if (target < this.index) {
      this.cursor = new RecInputCursor(this.demo.input);
      this.game = gameFromRec(this.demo, this.cursor, this.shadow);
      this.index = 0;
    }
    while (this.index < target) this.step();
  }
}

/**
 * Ceiling on frames a demo will be simulated for.
 *
 * `Buk14clean` is 27832 frames for a four-and-a-half minute run, so this is a couple of hours of
 * play. It exists because the loop below is bounded by the *input* running out, and a hostile
 * file can claim a stream that never does anything — a demo whose bytes never place a piece
 * would otherwise spin here.
 */
export const MAX_REC_FRAMES = 1_000_000;

export interface RecOutcome {
  frames: number;
  score: number;
  lines: number;
  level: number;
  /** Whether the run ended by topping out, as opposed to the input simply running out. */
  over: boolean;
  /** Whether every recorded byte was consumed. */
  complete: boolean;
}

/**
 * Run a demo to its end and report where it got to.
 *
 * The interesting use is not the frame count the viewer needs but the comparison a caller can
 * make afterwards: a `.rec` carries the score, lines and level its player finished on, and this
 * says what this engine reaches from the same seed and the same keystrokes. Those two numbers
 * agreeing is the strongest fidelity evidence the port has — see test/rec.test.ts.
 */
export function playRec(demo: RecDemo): RecOutcome {
  const cursor = new RecInputCursor(demo.input);
  const game = gameFromRec(demo, cursor);
  let frames = 0;
  while (!game.isOver && !cursor.spent && frames < MAX_REC_FRAMES) {
    game.stepFrame(1);
    frames++;
  }
  const c = game.canvas;
  return {
    frames,
    score: c.score,
    lines: c.linesTot,
    level: c.level,
    over: game.isOver,
    complete: cursor.at >= demo.input.length,
  };
}
