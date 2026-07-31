/*
 * Port of the simulation loop from source/quadra.cc:410-506 and the single-player game
 * setup from source/game.cc in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { Executor, Overmind } from './modules.js';
import { Canvas } from './canvas.js';
import { PlayerNormal, type PlayerEnv } from './player.js';

/** Milliseconds per simulation tick. The simulation is a fixed 100 Hz. */
export const TICK_MS = 10;
/** Accumulator ceiling. Beyond this the original skips frames outright rather than
 *  simulating them, to avoid a spiral of death (source/quadra.cc:497-500). */
export const MAX_ACCUMULATOR_MS = 300;

export interface GameOptions {
  /** Shared seed. Every client derives the same piece stream from it. */
  seed?: number | bigint;
  /** Starting level, 1-based. */
  level?: number;
  /** Whether clearing lines raises the level. */
  levelUp?: boolean;
  /** Draw the ghost piece. */
  shadow?: boolean;
}

/**
 * A single-player game: one board, the frame clock, and the module stack driving it.
 *
 * The simulation is deterministic and decoupled from rendering. Given the same seed and
 * the same input at the same frame numbers, it produces the same result every time — which
 * is what will later let the identical code run as the server-side authority.
 */
export class Game {
  readonly overmind = new Overmind();
  readonly canvas: Canvas;
  readonly env: PlayerEnv;
  private readonly executor = new Executor();
  private acc = 0;
  /**
   * Ticks actually simulated. Diverges from `frame` after a stall: the original bumps the
   * clock past a backlog instead of simulating it, so time-based rules stay honest while
   * the CPU cost stays bounded.
   */
  ticks = 0;

  constructor(opts: GameOptions = {}) {
    const { seed = 0, level = 1, levelUp = true, shadow = false } = opts;

    this.canvas = new Canvas(seed);
    this.canvas.level = level;
    this.canvas.shadow = shadow;
    this.canvas.calcSpeed();

    this.env = { overmind: this.overmind, videoFrame: 0, levelUp, paused: false };

    this.executor.add(new PlayerNormal(this.canvas, this.env));
    this.overmind.start(this.executor);
  }

  get frame(): number {
    return this.overmind.framecount;
  }

  get isOver(): boolean {
    return this.canvas.dead;
  }

  set paused(v: boolean) {
    this.env.paused = v;
  }

  get paused(): boolean {
    return this.env.paused;
  }

  /** Advance exactly one 10 ms simulation tick. */
  step(): void {
    this.ticks++;
    this.overmind.step();
  }

  /**
   * Mark the start of a rendered frame. Input is sampled at most once per rendered frame,
   * so hosts must call this once per animation frame — see PlayerEnv.videoFrame.
   */
  beginRenderFrame(): void {
    this.env.videoFrame++;
  }

  /**
   * Advance by elapsed wall-clock time, running as many fixed ticks as fit.
   * `source/quadra.cc:410-506`.
   */
  advance(deltaMs: number): void {
    this.beginRenderFrame();
    this.acc += deltaMs;
    if (this.acc > MAX_ACCUMULATOR_MS) {
      // Skip, don't simulate: bump the clock and drop the backlog.
      this.overmind.framecount += this.acc - MAX_ACCUMULATOR_MS;
      this.acc = MAX_ACCUMULATOR_MS;
    }
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.step();
    }
  }

  /**
   * Run `n` ticks, treating each as its own rendered frame so input is sampled every tick.
   * For headless use and tests.
   */
  runFrames(n: number): void {
    for (let i = 0; i < n; i++) {
      this.beginRenderFrame();
      this.step();
    }
  }

  /** Run until the predicate holds or the frame budget is exhausted. Returns frames used. */
  runUntil(predicate: () => boolean, maxFrames = 100_000): number {
    let used = 0;
    while (used < maxFrames && !predicate()) {
      this.beginRenderFrame();
      this.step();
      used++;
    }
    return used;
  }
}
