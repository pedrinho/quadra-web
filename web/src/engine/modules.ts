/*
 * Port of the coroutine scheduler from source/overmind.cc / overmind.h in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

/**
 * A unit of work that runs across frames. Only the top of an Executor's stack advances on
 * any given frame, so a Module is effectively a coroutine that yields after every step.
 *
 * This is reproduced faithfully rather than flattened into a state enum, because the
 * cascade's combo counter depends on the exact call/return semantics: Player_check_line
 * `call`s the flash/fall chain and is re-entered when it returns, and each re-entry is one
 * increment of `complexity`.
 */
export class Module {
  parent!: Executor;
  firstTime = true;
  done = false;

  /** Called once, on the module's first scheduled frame — not when it is added. */
  init(): void {}

  /** Called on every frame after init(), until ret(). */
  step(): void {}

  /**
   * Replace this module with another. Note the original implements this as call+ret, so
   * the new module is pushed *on top* and this one is popped only once the new one
   * returns — the two unwind together.
   */
  exec(module: Module): void {
    this.call(module);
    this.ret();
  }

  /** Suspend this module and run `module`; this one resumes after `module` returns. */
  call(module: Module): void {
    this.parent.add(module);
  }

  /** Finish this module. It is popped at the end of the current frame. */
  ret(): void {
    this.done = true;
  }
}

/**
 * A stack of Modules. `Executor::step` — source/overmind.cc:106-124.
 *
 * Exactly one module advances per frame: the top of the stack. A module's first scheduled
 * frame runs init() *instead of* step(), so entering a module costs one frame — timing the
 * port depends on preserving that.
 */
export class Executor {
  readonly modules: Module[] = [];
  done = false;
  private paused = false;

  constructor(private readonly selfDestruct = false) {}

  get isSelfDestruct(): boolean {
    return this.selfDestruct;
  }

  add(m: Module): void {
    this.modules.push(m);
    m.parent = this;
  }

  remove(): void {
    this.modules.pop();
  }

  pause(): void {
    this.paused = true;
  }

  unpause(): void {
    this.paused = false;
  }

  step(): void {
    if (this.paused) return;
    if (this.modules.length > 0) {
      const top = this.modules[this.modules.length - 1]!;
      if (!top.done) {
        if (top.firstTime) {
          top.firstTime = false;
          top.init();
        } else {
          top.step();
        }
      }
      // Unwind everything that finished. A module that called exec() sits under the module
      // it pushed, so it is only reached once that one is done — which is what makes
      // exec() behave as a tail call.
      while (this.modules.length > 0 && this.modules[this.modules.length - 1]!.done) {
        this.remove();
      }
    }
    if (this.modules.length === 0) this.done = true;
  }
}

/**
 * The frame clock. `Overmind::step` — source/overmind.cc:53-74.
 *
 * `framecount` is the master simulation clock, incremented once per 10 ms tick *before*
 * the executors run. Everything time-based in the game compares against it.
 */
export class Overmind {
  framecount = 0;
  done = false;
  private paused = false;
  private readonly execs: (Executor | null)[] = [];

  start(e: Executor): void {
    this.execs.push(e);
    this.done = false;
  }

  stop(e: Executor): void {
    for (let i = 0; i < this.execs.length; i++) if (this.execs[i] === e) this.execs[i] = null;
  }

  pause(): void {
    this.paused = true;
  }

  unpause(): void {
    this.paused = false;
  }

  step(): void {
    if (this.paused) return;
    this.framecount++;
    for (let i = 0; i < this.execs.length; i++) {
      const e = this.execs[i];
      if (!e) {
        this.execs.splice(i, 1);
        i--;
      } else {
        e.step();
        if (e.done) {
          this.execs.splice(i, 1);
          i--;
        }
      }
    }
    if (this.execs.length === 0) this.done = true;
  }
}
