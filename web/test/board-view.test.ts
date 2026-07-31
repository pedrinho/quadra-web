import { describe, it, expect } from 'vitest';
import { Framebuffer, SCREEN_WIDTH, SCREEN_HEIGHT } from '../src/render/framebuffer.js';
import { CELL, SMALL_CELL } from '../src/render/blocks.js';
import {
  drawPreview,
  BOARD_X,
  BOARD_Y,
  BOARD_W,
  BOARD_H,
  NEXT1,
  NEXT2,
  NEXT3,
} from '../src/render/board-view.js';
import type { QImage } from '../src/render/qimg.js';
import { Bloc } from '../src/engine/bloc.js';

/** A flat background, so anything the preview erases shows up as index 0. */
const background = (): QImage => ({
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  palette: new Uint8Array(768),
  indices: new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT),
});

const SENTINEL = 200;

/** Paint the playfield with a sentinel so any stray write into it is detectable. */
function boardFilled(): Framebuffer {
  const fb = new Framebuffer();
  for (let y = BOARD_Y; y < BOARD_Y + BOARD_H; y++) {
    fb.pixels.fill(SENTINEL, y * SCREEN_WIDTH + BOARD_X, y * SCREEN_WIDTH + BOARD_X + BOARD_W);
  }
  return fb;
}

function boardPixelsTouched(fb: Framebuffer): number {
  let touched = 0;
  for (let y = BOARD_Y; y < BOARD_Y + BOARD_H; y++) {
    for (let x = BOARD_X; x < BOARD_X + BOARD_W; x++) {
      if (fb.pixels[y * SCREEN_WIDTH + x] !== SENTINEL) touched++;
    }
  }
  return touched;
}

describe('next-piece previews', () => {
  const bg = background();
  const previews = [
    { name: 'next (small)', pos: NEXT1, small: true },
    { name: 'next2 (small)', pos: NEXT2, small: true },
    { name: 'next3 (full size)', pos: NEXT3, small: false },
  ];

  it.each(previews)('$name never draws into the playfield', ({ pos, small }) => {
    // The regression: Zone_next is four cells wide but only two tall (source/zone.h:98).
    // Erasing a four-cell square instead put the full-size third preview 35px into the
    // board, wiping the piece sliding down into view.
    for (let quel = 0; quel < 7; quel++) {
      const fb = boardFilled();
      drawPreview(fb, bg, new Bloc(quel, 0, 0, 0), pos.x, pos.y, small);
      expect(boardPixelsTouched(fb), `piece ${quel}`).toBe(0);
    }
  });

  it.each(previews)('$name clears the playfield when empty too', ({ pos, small }) => {
    const fb = boardFilled();
    drawPreview(fb, bg, null, pos.x, pos.y, small);
    expect(boardPixelsTouched(fb)).toBe(0);
  });

  it('draws the piece inside its two-cell zone, not below it', () => {
    // Pieces occupy grid rows 1 and 2 at rotation 0, and the original offsets the draw one
    // cell up (source/zone.cc:43) so those rows land in the zone. Without the offset the
    // piece sits a whole cell low.
    const fb = new Framebuffer();
    drawPreview(fb, bg, new Bloc(6, 0, 0, 0), NEXT3.x, NEXT3.y);

    const rowHasInk = (y: number) => {
      for (let x = NEXT3.x; x < NEXT3.x + CELL * 4; x++) {
        if (fb.pixels[y * SCREEN_WIDTH + x] !== 0) return true;
      }
      return false;
    };

    // Ink lives in the two-cell zone...
    expect(rowHasInk(NEXT3.y + 1)).toBe(true);
    expect(rowHasInk(NEXT3.y + CELL * 2 - 1)).toBe(true);
    // ...and nowhere below it, which is where the board starts.
    expect(rowHasInk(NEXT3.y + CELL * 2 + 1)).toBe(false);
    expect(rowHasInk(BOARD_Y + 1)).toBe(false);
  });

  it('keeps every preview zone clear of the board', () => {
    // A layout guard: the erase heights are what the previous version got wrong.
    expect(NEXT1.y + SMALL_CELL * 2).toBeLessThanOrEqual(BOARD_Y);
    expect(NEXT2.y + SMALL_CELL * 2).toBeLessThanOrEqual(BOARD_Y);
    expect(NEXT3.y + CELL * 2).toBeLessThanOrEqual(BOARD_Y);
  });
});
