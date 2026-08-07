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
} from './board-view.js';
import type { Canvas } from '../engine/canvas.js';

export class Screen {
  private readonly fb = new Framebuffer();
  private level = -1;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly backgrounds: readonly QImage[],
  ) {}

  /** Redraw the background next time, after switching which game is being shown. */
  invalidate(): void {
    this.level = -1;
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

    this.fb.present(this.ctx);
  }

  private background(): QImage {
    const bg = this.backgrounds[(this.level - 1) % this.backgrounds.length];
    if (!bg) throw new Error('no backgrounds loaded');
    return bg;
  }
}
