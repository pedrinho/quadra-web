import { describe, it, expect } from 'vitest';
import {
  DeathSweep,
  SWEEP_STEPS,
  SWEEP_TICKS,
  DEAD_COLOR,
  isSwept,
  sweepOrder,
  sweepSteps,
} from '../src/render/death-sweep.js';
import { drawBoard, BOARD_X, BOARD_Y } from '../src/render/board-view.js';
import { CELL, shade } from '../src/render/blocks.js';
import { Framebuffer, SCREEN_WIDTH, SCREEN_HEIGHT } from '../src/render/framebuffer.js';
import type { QImage } from '../src/render/qimg.js';
import { Canvas } from '../src/engine/canvas.js';
import { PLAY_BOTTOM, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, idx } from '../src/engine/board.js';
import { EDGE_ALL } from '../src/engine/pieces.js';
import { TICK_MS } from '../src/engine/game.js';

/**
 * `Player_dead::step` as written (source/player.cc:1223-1267), recording the step on which each
 * cell is first recoloured, and the steps after which the sample plays.
 */
function original(): { order: Map<number, number>; sounds: number[] } {
  const order = new Map<number, number>();
  const sounds: number[] = [];
  let i = 11;
  let j = 4;
  for (let step = 0; j < 9; step++) {
    for (const [r, c] of [
      [i, j],
      [42 - i, j],
      [i, 17 - j],
      [42 - i, 17 - j],
    ] as const) {
      if (!order.has(idx(r, c))) order.set(idx(r, c), step);
    }
    i++;
    if (i === 22) {
      j++;
      i = 11;
      sounds.push(step + 1);
    }
  }
  return { order, sounds };
}

describe('the death wipe', () => {
  it('greys every visible cell in the order Player_dead walks them', () => {
    const { order } = original();
    for (let r = PLAY_TOP; r < PLAY_BOTTOM; r++) {
      for (let c = PLAY_LEFT; c < PLAY_RIGHT; c++) {
        expect(order.get(idx(r, c)), `row ${r} col ${c}`).toBe(sweepOrder(r, c));
      }
    }
    expect(Math.max(...order.values()) + 1).toBe(SWEEP_STEPS);
  });

  it('starts at the outer columns and the bottom row, and ends in the middle', () => {
    expect(isSwept(PLAY_BOTTOM - 1, PLAY_LEFT, 1)).toBe(true);
    expect(isSwept(PLAY_BOTTOM - 1, PLAY_RIGHT - 1, 1)).toBe(true);
    // The top visible row is a step behind: the first step goes on hidden row 11.
    expect(isSwept(PLAY_TOP, PLAY_LEFT, 1)).toBe(false);
    expect(isSwept(PLAY_TOP, PLAY_LEFT, 2)).toBe(true);
    expect(isSwept(21, 8, SWEEP_STEPS - 1)).toBe(false);
    expect(isSwept(21, 8, SWEEP_STEPS)).toBe(true);
  });

  it('takes a step every other tick, starting the tick after the game ends', () => {
    // `if(c++&1) return` with c from 0, and the module's first tick spent on init.
    let c = 0;
    let steps = 0;
    for (let t = 1; t <= SWEEP_TICKS + 4; t++) {
      if (!(c++ & 1) && steps < SWEEP_STEPS) steps++;
      expect(sweepSteps(t), `tick ${t}`).toBe(steps);
    }
    expect(sweepSteps(0)).toBe(0);
    expect(sweepSteps(SWEEP_TICKS - 1)).toBe(SWEEP_STEPS - 1);
    expect(sweepSteps(SWEEP_TICKS)).toBe(SWEEP_STEPS);
  });
});

describe('DeathSweep', () => {
  const board = (dead = false) => ({ dead });

  it('stays out of the way while the game runs', () => {
    const sweep = new DeathSweep();
    const b = board();
    sweep.follow(b, 0);
    expect(sweep.follow(b, 1000)).toBe(0);
    expect(sweep.stepsFor(b)).toBe(0);
    expect(sweep.settled(b)).toBe(true);
  });

  it('plays out over the ticks after a death, sounding once per column', () => {
    const sweep = new DeathSweep();
    const b = board();
    sweep.follow(b, 16);
    b.dead = true;
    // The frame the death happened in: nothing yet.
    expect(sweep.follow(b, 16)).toBe(0);
    expect(sweep.stepsFor(b)).toBe(0);

    const { sounds } = original();
    const heard: number[] = [];
    for (let t = 1; t <= SWEEP_TICKS + 20; t++) {
      for (let n = sweep.follow(b, TICK_MS); n > 0; n--) heard.push(sweep.stepsFor(b));
      if (t < SWEEP_TICKS) expect(sweep.settled(b)).toBe(false);
    }
    expect(heard).toEqual(sounds);
    expect(sweep.stepsFor(b)).toBe(SWEEP_STEPS);
    expect(sweep.settled(b)).toBe(true);
  });

  it('shows a board that died out of sight already grey', () => {
    const sweep = new DeathSweep();
    const live = board();
    sweep.follow(live, 0);
    const other = board(true);
    expect(sweep.stepsFor(other)).toBe(SWEEP_STEPS);
    // And following it from there plays nothing.
    expect(sweep.follow(other, 0)).toBe(0);
    expect(sweep.follow(other, 5000)).toBe(0);
    expect(sweep.stepsFor(other)).toBe(SWEEP_STEPS);
  });

  it('starts over for a board wound back to before the death', () => {
    const sweep = new DeathSweep();
    const b = board(true);
    sweep.jumpTo(b);
    b.dead = false;
    sweep.follow(b, 16);
    expect(sweep.stepsFor(b)).toBe(0);
    b.dead = true;
    sweep.follow(b, 16);
    sweep.follow(b, TICK_MS * 21);
    expect(sweep.stepsFor(b)).toBe(11);
  });
});

describe('drawing a swept board', () => {
  const bg: QImage = {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    palette: new Uint8Array(768),
    indices: new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT),
  };
  /** The fill shade at the middle of a cell. */
  const fill = (fb: Framebuffer, row: number, col: number): number =>
    fb.pixels[
      (BOARD_Y + (row - PLAY_TOP) * CELL + 9) * SCREEN_WIDTH + BOARD_X + (col - PLAY_LEFT) * CELL + 9
    ]!;

  it('recolours swept cells grey and leaves the rest', () => {
    const canvas = new Canvas();
    const bottom = PLAY_BOTTOM - 1;
    for (let c = PLAY_LEFT; c < PLAY_RIGHT; c++) {
      canvas.occupied[idx(bottom, c)] = 1;
      canvas.block[idx(bottom, c)] = (3 << 4) | EDGE_ALL;
    }
    const fb = new Framebuffer();
    // One column's worth: the outer two cells of the bottom row go, the rest stay.
    drawBoard(fb, bg, canvas, 11);
    expect(fill(fb, bottom, PLAY_LEFT)).toBe(shade(DEAD_COLOR, 4));
    expect(fill(fb, bottom, PLAY_RIGHT - 1)).toBe(shade(DEAD_COLOR, 4));
    expect(fill(fb, bottom, PLAY_LEFT + 1)).toBe(shade(3, 4));

    drawBoard(fb, bg, canvas, 0);
    expect(fill(fb, bottom, PLAY_LEFT)).toBe(shade(3, 4));
  });
});
