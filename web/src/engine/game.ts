/*
 * Port of the simulation loop from source/quadra.cc:410-506 and the single-player game
 * setup from source/game.cc in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { Executor, Overmind } from './modules.js';
import { Canvas, groupsFromBindings, type Action, type InputSink } from './canvas.js';
import { PlayerNormal, type DemoInput, type PlayerEnv } from './player.js';
import { CURRENT_NET_VERSION } from './net-version.js';
import { DEFAULT_SENSITIVITY } from './sensitivity.js';
import type { SoundEvent } from './sound-events.js';
import type { Notice } from './notices.js';

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

/**
 * A game's starting configuration. Every field here is mutated while the game runs — the level
 * climbs, the seed is consumed, sensitivities are retuned — so anything that wants to rebuild
 * this game from scratch has to be told what it *began* as, not what it currently is.
 */
export interface GameStart {
  seed: bigint;
  level: number;
  levelUp: boolean;
  shadow: boolean;
  hSensitivity: number;
  vSensitivity: number;
  continuous: boolean;
  keyGroups: Uint8Array;
}

/**
 * An observer of everything that reaches the simulation from outside it.
 *
 * Structural rather than a concrete type, and deliberately narrow: the engine has to stay
 * importable by a server that knows nothing about recordings, so it describes the recorder it
 * talks to instead of depending on one. `src/replay/recorder.ts` is the implementation.
 *
 * The methods are the input seam below, one for one. If a new way to perturb a running game is
 * ever added to `Game`, it needs a method here too — otherwise recordings of it silently stop
 * reproducing, which is the failure mode this whole design exists to prevent.
 */
export interface GameRecorder {
  input(action: Action, down: boolean): void;
  paused(on: boolean): void;
  reconfigured(
    hSensitivity: number,
    vSensitivity: number,
    continuous: boolean,
    keyGroups: Uint8Array,
  ): void;
  keysCleared(): void;
  /** The top of a rendered frame, on the schedule already decided for it. */
  frame(step: FrameStep): void;
  /** The frame's ticks are done — the point at which the simulation's own changes to key
   *  state have all landed. */
  settled(): void;
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
  /** The grouping those bindings collapse to. What a recording carries, since the simulation
   *  never sees a key code. Applied after `keys` when both are given. */
  keyGroups?: readonly number[] | Uint8Array;
  /** Protocol version to play by. Defaults to `CURRENT_NET_VERSION`; only a 1998 demo lowers it. */
  netVersion?: number;
  /**
   * Take this frame's input from a recorded byte stream instead of the keyboard —
   * `Player_process_key::playback_control`, source/player.cc:284-296. Set only when watching a
   * 1998 `.rec`; a live game and a tape replay both leave it undefined and go through key state.
   */
  demo?: DemoInput;
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
  private recorder: GameRecorder | null = null;
  private acc = 0;
  /** What this game was built with. See GameStart — none of it survives in readable form. */
  readonly start: GameStart;
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
      keyGroups,
      netVersion = CURRENT_NET_VERSION,
      demo,
    } = opts;

    this.canvas = new Canvas(seed);
    this.canvas.level = level;
    this.canvas.shadow = shadow;
    this.canvas.hSensitivity = hSensitivity;
    this.canvas.vSensitivity = vSensitivity;
    this.canvas.continuous = continuous;
    this.canvas.reinit();
    if (keys) this.canvas.applyBindings(keys);
    if (keyGroups) this.canvas.applyKeyGroups(keyGroups);
    this.canvas.calcSpeed();

    this.env = {
      overmind: this.overmind,
      videoFrame: 0,
      levelUp,
      paused: false,
      sounds: [],
      notices: [],
      netVersion,
      ...(demo ? { demo } : {}),
    };

    // Read back rather than echo the arguments: the canvas has already normalised the seed to
    // 64 bits and the bindings to a canonical grouping, and it is those that drive the game.
    this.start = {
      seed: this.canvas.rnd.getSeed(),
      level,
      levelUp,
      shadow,
      hSensitivity,
      vSensitivity,
      continuous,
      keyGroups: this.canvas.keyGroups(),
    };

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
    this.recorder?.input(action, down);
  }

  setPaused(v: boolean): void {
    this.env.paused = v;
    this.recorder?.paused(v);
  }

  setSensitivity(hSensitivity: number, vSensitivity: number, continuous: boolean): void {
    this.reconfigure(hSensitivity, vSensitivity, continuous, this.canvas.keyGroups());
  }

  /** Rebind. The grouping changes underneath the sticky state, so the state goes. */
  setKeyGroups(groups: readonly number[] | Uint8Array): void {
    const c = this.canvas;
    this.reconfigure(c.hSensitivity, c.vSensitivity, c.continuous, groups);
    this.clearKeys();
  }

  /**
   * Install a whole configuration without touching key state. The two methods above are both
   * this one plus, at most, a clear — which is precisely how a recording stores them, so a
   * replay driver reaches for these two primitives and reproduces either.
   */
  reconfigure(
    hSensitivity: number,
    vSensitivity: number,
    continuous: boolean,
    keyGroups: readonly number[] | Uint8Array,
  ): void {
    this.canvas.hSensitivity = hSensitivity;
    this.canvas.vSensitivity = vSensitivity;
    this.canvas.continuous = continuous;
    this.canvas.reinit();
    this.canvas.setKeyGroups(keyGroups);
    this.recorder?.reconfigured(hSensitivity, vSensitivity, continuous, this.canvas.keyGroups());
  }

  clearKeys(): void {
    this.canvas.clearKeyAll();
    this.recorder?.keysCleared();
  }

  /**
   * Watch everything above. At most one recorder: a second would mean two tapes claiming to be
   * this game, and there is no honest way to choose between them.
   */
  attachRecorder(recorder: GameRecorder | null): void {
    this.recorder = recorder;
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

  /**
   * Take the on-screen notices queued since the last call. An output on the same terms as
   * `drainSounds` — a host that never calls this plays an identical game, it just says
   * nothing about what the moves were worth.
   */
  drainNotices(): Notice[] {
    return this.env.notices.splice(0, this.env.notices.length);
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
    // Told before it runs, not after: everything the host did has landed by now, and the
    // schedule is already decided, so this is the one moment where a recorder sees the frame
    // exactly as a replay of it will begin.
    this.recorder?.frame({ ticks, jump: framecountJump });
    this.beginRenderFrame();
    // Before the ticks, as in the original: the skipped time is already past.
    if (framecountJump) this.overmind.framecount += framecountJump;
    for (let i = 0; i < ticks; i++) this.step();
    this.recorder?.settled();
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
