/*
 * Port of the player module hierarchy from source/player.cc / player.h in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Networking, chat, stats logging, hot-potato and survivor handling are omitted; the
 * movement, timing and cascade behaviour are ported as written.
 */

import { Module, Overmind } from './modules.js';
import { Canvas, Action, PRESSED, RELEASED } from './canvas.js';
import { Bloc } from './bloc.js';
import { COLS, PLAY_BOTTOM, ROWS, idx } from './board.js';
import { clearFullLines, computeSupport, dropUnsupported } from './cascade.js';
import { giveLine } from './rules.js';
import type { SoundEvent } from './sound-events.js';
import type { Notice } from './notices.js';

/** Shared environment for the player modules. */
export interface PlayerEnv {
  overmind: Overmind;
  /**
   * Sounds the simulation wants played, oldest first. Write-only from in here — the engine
   * never reads it back, so draining it cannot change the game. See sound-events.ts.
   */
  sounds: SoundEvent[];
  /**
   * Text the simulation wants shown over the board, oldest first. Write-only on the same
   * terms as `sounds`, and for the same reason. See notices.ts.
   */
  notices: Notice[];
  /**
   * Rendered-frame counter. Input is sampled at most once per rendered frame
   * (source/player.cc:299-304), so DAS ticks at render rate, not simulation rate. The
   * host bumps this once per animation frame; headless callers bump it every tick to
   * sample input on every frame.
   */
  videoFrame: number;
  levelUp: boolean;
  paused: boolean;
}

/** Base for every player module: shared movement helpers and the per-frame housekeeping. */
export class PlayerBase extends Module {
  constructor(
    readonly canvas: Canvas,
    readonly env: PlayerEnv,
  ) {
    super();
  }

  override step(): void {
    // Blind countdown, every 16th frame (source/player.cc:56-66).
    if (!this.env.paused && !(this.env.overmind.framecount & 15)) {
      const { blinded, bflash } = this.canvas;
      for (let i = 0; i < blinded.length; i++) {
        if (blinded[i]) {
          if (!--blinded[i]!) bflash[i] = 24;
        }
      }
    }
  }

  /**
   * `Player_base::calc_by` — source/player.cc:69-71. Converts the 1/16-px fixed-point `y`
   * back to a grid row.
   *
   * Kept as verbatim integer arithmetic. `12*18<<4` is 3456; do not "simplify" this or
   * switch `y` to floating point, the rounding is load-bearing.
   */
  calcBy(py: number): number {
    return Math.trunc((((py + 15 + ((12 * 18) << 4)) >> 4) + 17) / 18);
  }

  /** `Player_base::rotate_left` — source/player.cc:135-148. */
  rotateLeft(): boolean {
    const c = this.canvas;
    const b = c.bloc!;
    const t = (b.rot - 1) & 3;
    if (!c.collide(b.bx, b.by, t)) {
      b.rot = t;
      this.env.sounds.push({ kind: 'rotate', column: b.bx });
      return true;
    }
    return false;
  }

  /** `Player_base::rotate_right` — source/player.cc:150-170. `twice` is the 180 spin. */
  rotateRight(twice = false): boolean {
    const c = this.canvas;
    const b = c.bloc!;
    const t = (b.rot + (twice ? 2 : 1)) & 3;
    if (!c.collide(b.bx, b.by, t)) {
      b.rot = t;
      this.env.sounds.push({ kind: 'rotate', column: b.bx });
      return true;
    }
    return false;
  }

  /** `Player_base::move_left` — source/player.cc:190-198. */
  moveLeft(): boolean {
    const c = this.canvas;
    const b = c.bloc!;
    if (!c.collide(b.bx - 1, b.by, b.rot)) {
      b.bx--;
      return true;
    }
    return false;
  }

  /** `Player_base::move_right` — source/player.cc:200-208. */
  moveRight(): boolean {
    const c = this.canvas;
    const b = c.bloc!;
    if (!c.collide(b.bx + 1, b.by, b.rot)) {
      b.bx++;
      return true;
    }
    return false;
  }

  /**
   * `Player_base::move_down` — source/player.cc:172-183. Soft drop.
   *
   * When blocked it "settles" the piece by parking `y` one unit short of the next row
   * boundary, so the next gravity step is guaranteed to collide and stamp.
   */
  moveDown(): void {
    const c = this.canvas;
    const b = c.bloc!;
    const t = this.calcBy(b.y + c.downSpeed);
    if (!c.collide(b.bx, t, b.rot)) {
      b.y += c.downSpeed;
      b.by = this.calcBy(b.y);
    } else {
      b.y = (((b.by - 12) * 18) << 4) - 1;
    }
  }

  /** `Player_base::drop_down` — source/player.cc:185-190. Hard drop. */
  dropDown(): void {
    const c = this.canvas;
    const b = c.bloc!;
    while (!c.checkCollide(b.quel, b.bx, b.by + 1, b.rot)) b.by++;
    b.calcXY();
  }
}

/**
 * `Player_normal` — source/player.cc:219-253. The idle dispatcher: fetches a piece when
 * there isn't one, otherwise hands control to the input/gravity module, or declares the
 * player dead if the fresh piece already overlaps the stack.
 */
export class PlayerNormal extends PlayerBase {
  override step(): void {
    super.step();
    const c = this.canvas;
    if (!c.bloc) {
      this.call(new PlayerGetNext(c, this.env));
    } else if (c.collide(c.bloc.bx, c.bloc.by, c.bloc.rot)) {
      this.call(new PlayerDead(c, this.env));
    } else {
      this.call(new PlayerProcessKey(c, this.env));
    }
  }
}

/**
 * `Player_get_next` — source/player.cc:255-273. Advances the 3-deep preview queue.
 *
 * On the first call every slot is empty, so the loop runs four times and fills the
 * pipeline; the piece the player receives is the first LCG draw.
 */
export class PlayerGetNext extends PlayerBase {
  override step(): void {
    super.step();
    const c = this.canvas;
    while (!c.bloc) this.shiftNext();
    c.frameStart = this.env.overmind.framecount;
    if (c.shadow) c.calcShadow();
    this.ret();
  }

  shiftNext(): void {
    const c = this.canvas;
    c.bloc = c.next3;
    c.next3 = c.next2;
    c.next2 = c.next;
    // Uniform mod 7. No bag, no history, no rerolls — four S pieces in a row is legal.
    const theNext = c.rnd.rnd() % 7;
    c.next = new Bloc(theNext, -1, 7, 10);
  }
}

/**
 * `Player_process_key` — source/player.cc:275-508. The main per-frame module for a live
 * player: sample input, advance the smooth position, apply gravity, and stamp on contact.
 */
export class PlayerProcessKey extends PlayerBase {
  private holdLeft = 0;
  private holdRight = 0;
  private lastVideoFrame = 0;
  private lastOvermindFrame = 0;
  blockRotated = 0;
  timeHeld = 0;

  override init(): void {
    const c = this.canvas;
    c.clearKey(Action.Drop);
    if (!c.continuous) c.clearKey(Action.Down);
  }

  /**
   * Retry a failed rotation one column toward the centre.
   *
   * This is the entire kick system — there is no SRS table. It only fires when the failed
   * rotation collided *purely* with the side walls, which `checkCollide` reports via
   * `collideSideOnly`.
   */
  private tryKick(rotate: () => boolean): boolean {
    const c = this.canvas;
    if (!c.collideSideOnly) return false;
    const b = c.bloc!;
    const inc = b.bx < 5 ? 1 : -1;
    if (!c.collide(b.bx + inc, b.by, b.rot)) {
      b.bx += inc;
      if (rotate()) return true;
      b.bx -= inc;
    }
    return false;
  }

  private keyboardControl(): void {
    const c = this.canvas;
    const env = this.env;

    // Input is sampled at most once per rendered frame, with up to 3 simulation frames of
    // catch-up. This is why DAS feels the way it does; removing the gate changes the feel.
    if (
      this.lastVideoFrame === env.videoFrame &&
      env.overmind.framecount - this.lastOvermindFrame > 3
    ) {
      return;
    }
    if (this.lastVideoFrame !== env.videoFrame) {
      this.lastVideoFrame = env.videoFrame;
      this.lastOvermindFrame = env.overmind.framecount;
    }

    let bougeLeft = false;
    let bougeRight = false;
    let autoBouge = false;

    // Rotations fire on RELEASE, not press.
    if (c.checkKey(Action.RotateLeft) & RELEASED) {
      if (this.rotateLeft()) this.blockRotated++;
      else if (this.tryKick(() => this.rotateLeft())) {
        autoBouge = true;
        this.blockRotated++;
      }
      c.clearKey(Action.RotateLeft);
    }
    if (c.checkKey(Action.RotateRight) & RELEASED) {
      if (this.rotateRight()) this.blockRotated++;
      else if (this.tryKick(() => this.rotateRight())) {
        autoBouge = true;
        this.blockRotated++;
      }
      c.clearKey(Action.RotateRight);
    }
    if (c.checkKey(Action.Rotate180) & RELEASED) {
      if (this.rotateRight(true)) this.blockRotated++;
      else if (this.tryKick(() => this.rotateRight(true))) {
        autoBouge = true;
        this.blockRotated++;
      }
      c.clearKey(Action.Rotate180);
    }

    if (c.checkKey(Action.Down) & (PRESSED | RELEASED)) {
      this.moveDown();
      c.unreleaseKey(Action.Down);
    }
    if (c.checkKey(Action.Drop) & PRESSED) {
      this.dropDown();
      c.clearKey(Action.Drop);
    }

    if (c.checkKey(Action.Left) & (PRESSED | RELEASED)) {
      bougeLeft = true;
      c.unreleaseKey(Action.Left);
    }
    if (c.checkKey(Action.Right) & (PRESSED | RELEASED)) {
      bougeRight = true;
      c.unreleaseKey(Action.Right);
    }

    // DAS. The first move arms a longer delay (+10) than subsequent repeats. Holding both
    // directions, or having just wall-kicked, cancels movement entirely.
    if (bougeLeft && !bougeRight && !autoBouge) {
      if (this.holdLeft < 2) {
        this.holdLeft = this.holdLeft === 0 ? c.hRepeatDelay + 10 : c.hRepeatDelay;
        if (!this.moveLeft()) this.holdLeft = 1;
      } else {
        this.holdLeft--;
      }
    } else {
      this.holdLeft = 0;
    }

    if (bougeRight && !bougeLeft && !autoBouge) {
      if (this.holdRight < 2) {
        this.holdRight = this.holdRight === 0 ? c.hRepeatDelay + 10 : c.hRepeatDelay;
        if (!this.moveRight()) this.holdRight = 1;
      } else {
        this.holdRight--;
      }
    } else {
      this.holdRight = 0;
    }
  }

  override step(): void {
    super.step();
    const c = this.canvas;
    if (this.env.paused) return;
    if (!c.bloc) return;

    this.timeHeld++;
    this.keyboardControl();

    const b = c.bloc;

    // Chase the authoritative grid column with the cosmetic smooth position.
    const target = ((b.bx - 4) << 4) * 18;
    let nx = b.x;
    if (nx < target) {
      nx += c.sideSpeed;
      if (nx > target) nx = target;
    }
    if (nx > target) {
      nx -= c.sideSpeed;
      if (nx < target) nx = target;
    }
    // Only accept the smooth move if it doesn't slide through a block.
    if (!c.collide(b.bx, this.calcBy(b.y - (17 << 4) - 15), b.rot)) b.x = nx;

    // Gravity. There is no lock delay: the moment the next step would collide, the piece
    // is stamped.
    if (c.collide(b.bx, this.calcBy(b.y + c.speed), b.rot)) {
      this.exec(new PlayerStamp(c, this.env));
      return;
    }

    b.y += c.speed;
    b.by = this.calcBy(b.y);
    if (c.shadow) c.calcShadow();
  }
}

/**
 * `Player_stamp` — source/player.cc:1440-1490. Welds the piece into the board, then queues
 * the line check.
 */
export class PlayerStamp extends PlayerBase {
  constructor(canvas: Canvas, env: PlayerEnv) {
    super(canvas, env);
    // The original does the stamping in the constructor, before init() schedules the chain.
    this.canvas.moved.fill(0);
    this.stampBloc();
  }

  stampBloc(): void {
    const c = this.canvas;
    const b = c.bloc!;
    const grid = b.grid();

    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const t = grid[j]![i]!;
        if (!t) continue;
        const row = b.by + j;
        const col = b.bx + i;
        // The cell keeps the piece's edge mask verbatim — that is what welds the four
        // cells to each other and to nothing else.
        c.setCell(row, col, t, b.quel);
        c.moved[idx(row, col)] = 1;
        c.lastX = i;
      }
    }
    c.lastX += b.bx;

    this.env.sounds.push({ kind: 'land', column: b.bx });

    c.bloc = null;
    c.blocShadow = null;
  }

  override init(): void {
    this.call(new PlayerCheckLine(this.canvas, this.env));
    this.ret();
  }
}

/**
 * `Player_check_line` — source/player.cc:527-583. Clears full rows and drives the cascade.
 *
 * The re-entry after the fall settles is what makes chains work, and each re-entry is one
 * increment of `complexity`.
 */
export class PlayerCheckLine extends PlayerBase {
  override step(): void {
    super.step();
    const c = this.canvas;
    const cleared = clearFullLines(c);

    if (cleared.count) {
      c.depth += cleared.count;
      c.complexity++;
      if (c.isClean()) {
        c.sendForClean = true;
        // `check_clean` announces it here, at the erase — not with the score, which is still
        // a flash and a whole cascade away (source/player.cc:585-595).
        this.env.notices.push({ kind: 'clean' });
      }
      // The original plays this from the Player_flash_lines constructor, after complexity
      // has been bumped — so the pitch drop reflects the chain step just entered.
      this.env.sounds.push({ kind: 'lineClear', chain: c.complexity });
      // call(), not exec() — so this module runs again once the fall has settled.
      this.call(new PlayerFlashLines(c, this.env));
    } else {
      // The original spawns a whole Player_level_up module from Canvas::give_line just to
      // play this (source/player.cc:973-976); here the level bump is a plain field, so
      // watch it rather than teaching the scoring rules about sound.
      const levelBefore = c.level;
      // Read before the call: give_line zeroes `depth` on its way out, and the award it
      // returns is the only place the full number for this move ever exists.
      const depth = c.depth;
      const scoreAdd = giveLine(c, this.env.levelUp);
      // Two lines or more, as `i && enough` works out to in single player — see notices.ts.
      if (depth >= 2) this.env.notices.push({ kind: 'clear', depth, score: scoreAdd });
      if (c.level !== levelBefore) this.env.sounds.push({ kind: 'levelUp' });
      this.ret();
    }
  }
}

/**
 * `Player_flash_lines` — source/player.cc:727-755. Sixteen frames of flashing the cleared
 * rows, then hand over to the fall.
 */
export class PlayerFlashLines extends PlayerBase {
  static readonly FRAMES = 16;
  private anim = 0;

  override step(): void {
    super.step();
    if (this.anim < PlayerFlashLines.FRAMES) {
      this.anim++;
      return;
    }
    this.canvas.clearTmp();
    this.exec(new PlayerCheckLink(this.canvas, this.env));
  }
}

/**
 * `Player_check_link` — source/player.cc:767-830. The rigid-body fall.
 *
 * Alternates two phases, one per frame: mark what is supported, then drop everything that
 * isn't by one row. So the stack visibly falls at one row per two frames.
 */
export class PlayerCheckLink extends PlayerBase {
  private anim = 0;
  /** Rows fallen so far — the original uses this to pitch the landing sound. */
  tombe = 0;

  constructor(canvas: Canvas, env: PlayerEnv) {
    super(canvas, env);
    this.canvas.moved.fill(0);
  }

  override step(): void {
    super.step();
    const c = this.canvas;

    if (this.anim === 0) {
      computeSupport(c);
      this.anim++;
      return;
    }

    this.anim = 0;
    if (dropUnsupported(c)) {
      this.tombe++;
      // Deliberately no clearTmp() here. The original clears it once on entry and lets the
      // marks accumulate: supported cells never move, so their marks stay valid, and
      // clearing would also wipe `moved`, which carries the garbage hole positions.
    } else {
      // Only when something actually fell — source/player.cc:849.
      if (this.tombe) {
        this.env.sounds.push({
          kind: 'cascadeSettled',
          chain: c.complexity,
          rowsFallen: this.tombe,
        });
      }
      this.ret();
    }
  }
}

/**
 * `Player_dead` — source/player.cc:1127-1221, reduced to the state change. The original
 * also classifies the death for statistics.
 */
export class PlayerDead extends PlayerBase {
  override init(): void {
    const c = this.canvas;
    c.dead = true;
    this.env.sounds.push({ kind: 'gameOver' });
    c.bloc = null;
    c.blocShadow = null;
    this.ret();
  }
}

/** Rows and columns re-exported for hosts that drive the engine. */
export { ROWS, COLS, PLAY_BOTTOM };
