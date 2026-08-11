import { describe, it, expect } from 'vitest';
import { Game } from '../src/engine/game.js';
import { Canvas, FLASH_BRIGHT, FLASH_DIM } from '../src/engine/canvas.js';
import { PLAY_BOTTOM, PLAY_TOP } from '../src/engine/board.js';
import { Framebuffer, SCREEN_WIDTH } from '../src/render/framebuffer.js';
import { CELL } from '../src/render/blocks.js';
import { drawFlash, BOARD_X, BOARD_Y, BOARD_W } from '../src/render/board-view.js';
import { Autoplayer, SCORING_SEED } from './autoplay.js';

/**
 * The line-clear flash — `Player_flash_lines` (source/player.cc:727-755) painted by
 * `Canvas::blit_flash` (source/canvas.cc:862-872).
 *
 * The port had the sixteen frames and the sound but drew nothing in them, so a clear read as
 * rows vanishing followed by a dead pause. These pin the two halves that were missing: which
 * rows the simulation nominates, and what the renderer puts there.
 */

/** Run the stacker until a flash is up, returning the game parked on that frame. */
function untilFlash(game: Game, player: Autoplayer, budget = 6000): boolean {
  for (let i = 0; i < budget && !game.isOver; i++) {
    player.frame();
    game.stepFrame(1);
    if (game.canvas.colorFlash) return true;
  }
  return false;
}

/** The rows currently nominated, with the empty slots dropped. */
const litRows = (canvas: Canvas): number[] => [...canvas.flash].filter((row) => row !== 0);

describe('the line-clear flash', () => {
  it('nominates the cleared rows and lights up on the frame they are erased', () => {
    const game = new Game({ seed: SCORING_SEED });
    expect(untilFlash(game, new Autoplayer(game))).toBe(true);

    const rows = litRows(game.canvas);
    expect(rows.length).toBeGreaterThan(0);
    // Playable rows only. 0 has to stay reserved as the empty slot, and it is safe to reserve
    // because row 0 is up in the spawn buffer and can never be cleared.
    for (const row of rows) {
      expect(row).toBeGreaterThanOrEqual(PLAY_TOP);
      expect(row).toBeLessThan(PLAY_BOTTOM);
    }
    // The rows are already empty: the erase happens before the flash, so the animation paints
    // over the gap rather than doing anything to the blocks.
    for (const row of rows) {
      for (let col = 4; col < 14; col++) expect(game.canvas.isOccupied(row, col)).toBe(false);
    }
    // Set by the module's constructor, which runs on the same frame as the erase — an init()
    // would cost a frame and leave this one blank.
    expect(game.canvas.colorFlash).toBe(FLASH_BRIGHT);
  });

  it('holds each colour for two frames, then tears down and lets the stack fall', () => {
    const game = new Game({ seed: SCORING_SEED });
    expect(untilFlash(game, new Autoplayer(game))).toBe(true);

    const seen = [game.canvas.colorFlash];
    while (game.canvas.colorFlash && seen.length < 40) {
      game.stepFrame(1);
      seen.push(game.canvas.colorFlash);
    }

    const W = FLASH_BRIGHT;
    const D = FLASH_DIM;
    // Four frames of white before the alternation starts, and that is faithful rather than an
    // off-by-two: the constructor sets it on the erase frame, the module's first scheduled
    // frame runs init() instead of step() (source/overmind.cc:106-124), and only then do two
    // step()s read `anim` 0 and 1. From there `(anim>>1)&1` flips every second frame.
    expect(seen).toEqual([W, W, W, W, D, D, W, W, D, D, W, W, D, D, W, W, D, D, 0]);
    // Eighteen lit frames, then the teardown frame — the sixteen the original counts plus the
    // constructor's and init()'s. Changing this changes how long a cascade takes, so every
    // committed tape's frame count is downstream of it.
    expect(seen.length - 1).toBe(18);

    // Torn down together: nothing is left nominated once the colour goes.
    expect(litRows(game.canvas)).toEqual([]);
  });

  it('re-arms on the next clear rather than accumulating rows', () => {
    const game = new Game({ seed: SCORING_SEED });
    const player = new Autoplayer(game);
    expect(untilFlash(game, player)).toBe(true);
    const first = litRows(game.canvas);

    // Out of this flash, then on to the next one.
    while (game.canvas.colorFlash) game.stepFrame(1);
    expect(untilFlash(game, player)).toBe(true);
    const second = litRows(game.canvas);

    expect(second.length).toBeGreaterThan(0);
    // The array is zeroed on teardown, so a shorter clear after a longer one cannot leave a
    // stale row behind to flash a band of board that is still full.
    expect(second).toEqual([...game.canvas.flash].slice(0, second.length));
    expect(first).not.toEqual([]);
  });
});

describe('drawing the flash', () => {
  /** A canvas with the flash state set directly — the renderer's whole input. */
  function lit(rows: number[], colorFlash = FLASH_BRIGHT): Canvas {
    const canvas = new Canvas(1);
    rows.forEach((row, i) => {
      canvas.flash[i] = row;
    });
    canvas.colorFlash = colorFlash;
    return canvas;
  }

  const pixel = (fb: Framebuffer, x: number, y: number) => fb.pixels[y * SCREEN_WIDTH + x];

  it('fills the full height and width of each nominated row', () => {
    const fb = new Framebuffer();
    const row = PLAY_TOP + 5;
    drawFlash(fb, lit([row]));

    const top = BOARD_Y + (row - PLAY_TOP) * CELL;
    for (let i = 0; i < CELL; i++) {
      expect(pixel(fb, BOARD_X, top + i)).toBe(FLASH_BRIGHT);
      // `10*18-1` — the bar stops one pixel short of the well, which is the original's own
      // edge (source/canvas.cc:867) and not a rounding slip here.
      expect(pixel(fb, BOARD_X + BOARD_W - 2, top + i)).toBe(FLASH_BRIGHT);
      expect(pixel(fb, BOARD_X + BOARD_W - 1, top + i)).toBe(0);
    }
    // Nothing above or below the band.
    expect(pixel(fb, BOARD_X, top - 1)).toBe(0);
    expect(pixel(fb, BOARD_X, top + CELL)).toBe(0);
  });

  it('draws every nominated row and skips the empty slots', () => {
    const fb = new Framebuffer();
    const rows = [PLAY_TOP + 2, PLAY_TOP + 3, PLAY_TOP + 9];
    drawFlash(fb, lit(rows));

    for (const row of rows) {
      const top = BOARD_Y + (row - PLAY_TOP) * CELL;
      expect(pixel(fb, BOARD_X + 4, top + 4)).toBe(FLASH_BRIGHT);
    }
    // A row that was not nominated, between two that were.
    const untouched = BOARD_Y + (PLAY_TOP + 5 - PLAY_TOP) * CELL;
    expect(pixel(fb, BOARD_X + 4, untouched + 4)).toBe(0);
  });

  it('paints in whichever index the simulation is currently on', () => {
    const fb = new Framebuffer();
    drawFlash(fb, lit([PLAY_TOP + 1], FLASH_DIM));
    expect(pixel(fb, BOARD_X + 4, BOARD_Y + CELL + 4)).toBe(FLASH_DIM);
  });

  it('holds the bright index when asked for a steady bar', () => {
    const fb = new Framebuffer();
    // Reduced motion drops the toggle, not the bar: the dim frames still paint, in bright.
    drawFlash(fb, lit([PLAY_TOP + 1], FLASH_DIM), true);
    expect(pixel(fb, BOARD_X + 4, BOARD_Y + CELL + 4)).toBe(FLASH_BRIGHT);
  });
});
