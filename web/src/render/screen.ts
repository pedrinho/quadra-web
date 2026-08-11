/*
 * Drawing one playfield onto the page's canvas.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Pulled out of the entry point so that a replay can be drawn by exactly the code that draws
 * the live game. A viewer that rendered its own way would be able to show a game the engine
 * cannot produce, which is the one thing a replay must never do.
 *
 * It takes a `Canvas` and nothing else — no game, no clock — because everything visible is a
 * function of the playfield state.
 */

import { Framebuffer } from './framebuffer.js';
import type { QImage } from './qimg.js';
import type { Fontdata } from './font.js';
import { TextScrollers } from './scrollers.js';
import {
  drawBoard,
  drawFallingPiece,
  drawFlash,
  drawPreview,
  drawBonusColumn,
  NEXT1,
  NEXT2,
  NEXT3,
} from './board-view.js';
import type { Canvas } from '../engine/canvas.js';

/*
 * The middle pane's frame, measured off the backdrops. Every `fond` paints the border straight
 * into the artwork rather than drawing it as chrome, so these are pixel columns and rows of the
 * image, not constants the game computes: verticals at x 218-220 and x 422, rules at y 31-33 and
 * y 400-402, plus an inner divider at x 404 bracketing the bonus column.
 */
const FRAME_LEFT = 218;
const FRAME_RIGHT = 422;
const FRAME_BOTTOM = 402;
/** Air outside the border, so it reads as an edge rather than as the crop running out. */
const FRAME_MARGIN = 2;

/**
 * The part of the 640x480 frame worth putting on a page: the middle pane, its own border
 * included, and the preview strip above it.
 *
 * The original's frame is three of these panes and single player fills only the middle one, so
 * the two empty thirds and the application chrome around them stay cropped away. The pane's own
 * border does not — it is the edge of the board rather than decoration around it, and cropping
 * to `BOARD_X` landed three pixels inside it, which is why the board used to arrive on the page
 * as a bare rectangle. The top stays at 0: the next-piece previews sit above the border, where
 * the original puts them.
 *
 * It stops below the bottom rule. Further down is the original's SCORE/LINES/LEVEL plate, and
 * the page keeps its own readouts in HTML rather than blitting that.
 */
export const PLAYFIELD_VIEW = {
  x: FRAME_LEFT - FRAME_MARGIN,
  y: 0,
  width: FRAME_RIGHT - FRAME_LEFT + 1 + FRAME_MARGIN * 2,
  height: FRAME_BOTTOM + 1 + FRAME_MARGIN,
} as const;

export class Screen {
  /** Public because other things draw into it too; only the playfield needs the rest of this. */
  readonly fb = new Framebuffer();
  /**
   * The text that rises when a move scores. It hangs off the screen rather than off any one
   * host because there is only ever one screen: the live game, the attract loop and the replay
   * viewer take turns with it, and each one only has to say which game to follow.
   *
   * Null without a face to set it in, which keeps a `Screen` cheap to build in a test.
   */
  readonly scrollers: TextScrollers | null;
  private level = -1;

  /**
   * Held rather than re-queried so the browser parses the query once, but read at draw time
   * rather than cached as a boolean, so changing the setting takes effect without a reload.
   *
   * Null off the browser — a `Screen` is built in tests, and those get the faithful strobe,
   * which is what the assertions are about.
   */
  private readonly reduceMotion: MediaQueryList | null =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    /** Per level, and filled in as they load — level 1 is the only one needed to start. */
    private readonly backgrounds: readonly (QImage | undefined)[],
    /** The face the scrolling text is set in. Without one, there is no scrolling text. */
    font?: Fontdata,
    /**
     * What reaches the page. The original's frame is three 214px panes and single player only
     * ever fills the middle one, so showing all of it means showing two empty thirds and the
     * application chrome around them — that stays cropped away. The middle pane's own border
     * does not: it is the edge of the board rather than chrome around it, and the board looks
     * like an unfinished rectangle without it. Everything still draws at the original
     * coordinates.
     */
    private readonly view: { x: number; y: number; width: number; height: number } = PLAYFIELD_VIEW,
  ) {
    this.scrollers = font ? new TextScrollers(font) : null;
  }

  /** Redraw the background next time, after switching which game is being shown. */
  invalidate(): void {
    this.level = -1;
  }

  /** Hand the framebuffer to a screen with a palette of its own, such as a menu. */
  usePalette(palette: Uint8Array): void {
    this.fb.setPalette(palette);
    this.scrollers?.invalidateFont();
    this.invalidate();
  }

  present(): void {
    this.fb.presentRegion(this.ctx, this.view.x, this.view.y, this.view.width, this.view.height);
  }

  draw(canvas: Canvas): void {
    // A level change swaps the background and its palette, exactly as Canvas::change_level
    // does in the original.
    if (canvas.level !== this.level) {
      this.level = canvas.level;
      const bg = this.background();
      this.fb.setPalette(bg.palette);
      this.fb.putImage(bg.indices, bg.width, bg.height, 0, 0);
      // Every level has its own palette, and a font is built against one.
      this.scrollers?.invalidateFont();
    }

    const bg = this.background();
    drawBoard(this.fb, bg, canvas);
    if (canvas.blocShadow) drawFallingPiece(this.fb, canvas.blocShadow, true);
    if (canvas.bloc) drawFallingPiece(this.fb, canvas.bloc);
    // After the piece and over it, as Zone_canvas_bloc::draw has it (source/zone.cc:63-73).
    if (canvas.colorFlash) drawFlash(this.fb, canvas, this.reduceMotion?.matches ?? false);

    // Previews sit in the header strip above the board, nearest one smallest.
    drawPreview(this.fb, bg, canvas.next3, NEXT3.x, NEXT3.y);
    drawPreview(this.fb, bg, canvas.next2, NEXT2.x, NEXT2.y, true);
    drawPreview(this.fb, bg, canvas.next, NEXT1.x, NEXT1.y, true);
    drawBonusColumn(this.fb, bg, canvas);
    // Over the board, and last: `drawBoard` restores the whole well from the backdrop every
    // frame, which is the erase the original does with `Zone_combo::dirt_rect`.
    this.scrollers?.draw(this.fb);

    this.present();
  }

  /** The badge the original lays over a paused board (source/multi_player.cc:257). */
  drawPaused(badge: QImage): void {
    const x = this.view.x + ((this.view.width - badge.width) >> 1);
    const y = this.view.y + ((this.view.height - badge.height) >> 1);
    this.fb.putImage(badge.indices, badge.width, badge.height, x, y, true);
    this.present();
  }

  private background(): QImage {
    // Falling back to the first keeps a level-up from stalling on a backdrop still in flight.
    const bg = this.backgrounds[(this.level - 1) % this.backgrounds.length] ?? this.backgrounds[0];
    if (!bg) throw new Error('no backgrounds loaded');
    return bg;
  }
}
