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
import {
  drawBoard,
  drawFallingPiece,
  drawPreview,
  drawBonusColumn,
  NEXT1,
  NEXT2,
  NEXT3,
  BOARD_X,
  BOARD_Y,
  BOARD_W,
  BOARD_H,
} from './board-view.js';
import type { Canvas } from '../engine/canvas.js';

/**
 * The part of the 640x480 frame worth putting on a page: the playfield and the preview strip
 * directly above it, and nothing else.
 *
 * The original's frame is three 214px panes with a drawn border around each, and single player
 * fills only the middle one. Cropping to the board drops two empty thirds, the borders and the
 * garbage column that stays empty until there is an opponent to send it — none of which is the
 * game, all of which is the application.
 */
export const PLAYFIELD_VIEW = { x: BOARD_X, y: 0, width: BOARD_W, height: BOARD_Y + BOARD_H } as const;

export class Screen {
  /** Public because other things draw into it too; only the playfield needs the rest of this. */
  readonly fb = new Framebuffer();
  private level = -1;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    /** Per level, and filled in as they load — level 1 is the only one needed to start. */
    private readonly backgrounds: readonly (QImage | undefined)[],
    /**
     * What reaches the page. The original's frame is three 214px panes and single player only
     * ever fills the middle one, so showing all of it means showing two empty thirds and the
     * application chrome around them. Everything still draws at the original coordinates.
     */
    private readonly view: { x: number; y: number; width: number; height: number } = PLAYFIELD_VIEW,
  ) {}

  /** Redraw the background next time, after switching which game is being shown. */
  invalidate(): void {
    this.level = -1;
  }

  /** Hand the framebuffer to a screen with a palette of its own, such as a menu. */
  usePalette(palette: Uint8Array): void {
    this.fb.setPalette(palette);
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
    }

    const bg = this.background();
    drawBoard(this.fb, bg, canvas);
    if (canvas.blocShadow) drawFallingPiece(this.fb, canvas.blocShadow, true);
    if (canvas.bloc) drawFallingPiece(this.fb, canvas.bloc);

    // Previews sit in the header strip above the board, nearest one smallest.
    drawPreview(this.fb, bg, canvas.next3, NEXT3.x, NEXT3.y);
    drawPreview(this.fb, bg, canvas.next2, NEXT2.x, NEXT2.y, true);
    drawPreview(this.fb, bg, canvas.next, NEXT1.x, NEXT1.y, true);
    drawBonusColumn(this.fb, bg, canvas);

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
