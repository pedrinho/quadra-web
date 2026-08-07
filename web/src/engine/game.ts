/*
 * Port of the simulation loop from source/quadra.cc:410-506 and the single-player game
 * setup from source/game.cc in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { Executor, Overmind } from './modules.js';
import { Canvas, groupsFromBindings, type Action, type InputSink } from './canvas.js';
import { PlayerNormal, type PlayerEnv } from './player.js';
import { DEFAULT_SENSITIVITY } from './sensitivity.js';
import type { SoundEvent } from './sound-events.js';

/** Milliseconds per simulation tick. The simulation is a fixed 100 Hz. */
export const TICK_MS = 10;
/** Accumulator ceiling. Beyond this the original skips frames outright rather than
 *  simulating them, to avoid a spiral of death (source/quadra.cc:497-500). */
export const MAX_ACCUMULATOR_MS = 300;

/**
 * What one rendered frame did: how many 10 ms ticks it ran, and how far it bumped the clock
 * past a backlog without simulating. Together with the input applied before it, this is
 * everything needed to reproduce the frame.
 */
export interface FrameStep {
  ticks: number;
  jump: number;
}

export interface GameOptions {
  /** Shared seed. Every client derives the same piece stream from it. */
  seed?: number | bigint;
  /** Starting level, 1-based. */
  level?: number;
  /** Whether clearing lines raises the level. */
  levelUp?: boolean;
  /** Draw the ghost piece. */
  shadow?: boolean;
  /** Horizontal repeat speed, 0-100%. See engine/sensitivity.ts. */
  hSensitivity?: number;
  /** Soft-drop speed, 0-100%. */
  vSensitivity?: number;
  /** When false the soft-drop key must be re-pressed for each new piece. */
  continuous?: boolean;
  /** `KeyboardEvent.code` per action slot, so actions sharing a key share sticky state. */
  keys?: readonly string[];
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
    const {
      seed = 0,
      level = 1,
      levelUp = true,
      shadow = false,
      hSensitivity = DEFAULT_SENSITIVITY,
      vSensitivity = DEFAULT_SENSITIVITY,
      continuous = true,
      keys,
    } = opts;

    this.canvas = new Canvas(seed);
    this.canvas.level = level;
    this.canvas.shadow = shadow;
    this.canvas.hSensitivity = hSensitivity;
    this.canvas.vSensitivity = vSensitivity;
    this.canvas.continuous = continuous;
    this.canvas.reinit();
    if (keys) this.canvas.applyBindings(keys);
    this.canvas.calcSpeed();

    this.env = { overmind: this.overmind, videoFrame: 0, levelUp, paused: false, sounds: [] };

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
    this.setPaused(v);
  }

  get paused(): boolean {
    return this.env.paused;
  }

  /* --- the input boundary -------------------------------------------------
   *
   * Everything the host can change about a running game goes through these four methods.
   * Not just keys: pausing, retuning the repeat speed and rebinding all feed the simulation
   * too (env.paused gates PlayerProcessKey, the sensitivities become hRepeatDelay/sideSpeed/
   * downSpeed, and the key grouping decides which actions share a sticky slot). A recorder
   * that watched only the keyboard would miss three of the four and produce a game that does
   * not play back.
   */

  input(action: Action, down: boolean): void {
    if (down) this.canvas.pressKey(action);
    else this.canvas.releaseKey(action);
  }

  setPaused(v: boolean): void {
    this.env.paused = v;
  }

  setSensitivity(hSensitivity: number, vSensitivity: number, continuous: boolean): void {
    this.canvas.hSensitivity = hSensitivity;
    this.canvas.vSensitivity = vSensitivity;
    this.canvas.continuous = continuous;
    this.canvas.reinit();
  }

  setKeyGroups(groups: readonly number[] | Uint8Array): void {
    this.canvas.applyKeyGroups(groups);
  }

  /** An `InputSink` view of the above, for handing to `Keyboard`. */
  get inputSink(): InputSink {
    return {
      pressKey: (i) => this.input(i, true),
      releaseKey: (i) => this.input(i, false),
      applyBindings: (codes) => this.setKeyGroups(groupsFromBindings(codes)),
    };
  }

  /**
   * Take the sounds queued since the last call. Purely an output — the simulation never
   * reads them, so a host that ignores sound plays an identical game.
   */
  drainSounds(): SoundEvent[] {
    return this.env.sounds.splice(0, this.env.sounds.length);
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
   * Run one rendered frame on a schedule that has already been decided — by the wall clock
   * in `advance`, or by a recording being played back. This is the only place a frame is
   * executed, so a replayed frame cannot drift from a live one.
   */
  stepFrame(ticks: number, framecountJump = 0): void {
    this.beginRenderFrame();
    // Before the ticks, as in the original: the skipped time is already past.
    if (framecountJump) this.overmind.framecount += framecountJump;
    for (let i = 0; i < ticks; i++) this.step();
  }

  /**
   * Advance by elapsed wall-clock time, running as many fixed ticks as fit.
   * `source/quadra.cc:410-506`. Returns the schedule it decided on, which is exactly what a
   * recording needs to store in order to reproduce this frame.
   */
  advance(deltaMs: number): FrameStep {
    this.acc += deltaMs;
    let jump = 0;
    if (this.acc > MAX_ACCUMULATOR_MS) {
      // Skip, don't simulate: bump the clock and drop the backlog. Floored, because
      // framecount is an integer clock everywhere else — `framecount & 15` in the blind
      // countdown and `framecount - lastOvermindFrame > 3` in the input gate both assume it.
      jump = Math.floor(this.acc - MAX_ACCUMULATOR_MS);
      this.acc = MAX_ACCUMULATOR_MS;
    }
    let ticks = 0;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      ticks++;
    }
    this.stepFrame(ticks, jump);
    return { ticks, jump };
  }

  /**
   * Run `n` ticks, treating each as its own rendered frame so input is sampled every tick.
   * For headless use and tests.
   */
  runFrames(n: number): void {
    for (let i = 0; i < n; i++) this.stepFrame(1);
  }

  /** Run until the predicate holds or the frame budget is exhausted. Returns frames used. */
  runUntil(predicate: () => boolean, maxFrames = 100_000): number {
    let used = 0;
    while (used < maxFrames && !predicate()) {
      this.stepFrame(1);
      used++;
    }
    return used;
  }
}
