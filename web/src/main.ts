/*
 * Browser entry point.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { Game } from './engine/game.js';
import { Framebuffer, SCREEN_WIDTH, SCREEN_HEIGHT } from './render/framebuffer.js';
import { loadQimg, type QImage } from './render/qimg.js';
import {
  drawBoard,
  drawFallingPiece,
  drawPreview,
  drawBonusColumn,
  NEXT1,
  NEXT2,
  NEXT3,
} from './render/board-view.js';
import { Keyboard } from './input/keyboard.js';
import { Bloc } from './engine/bloc.js';

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
};

async function main(): Promise<void> {
  const canvasEl = el<HTMLCanvasElement>('screen');
  canvasEl.width = SCREEN_WIDTH;
  canvasEl.height = SCREEN_HEIGHT;
  const ctx = canvasEl.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('could not get a 2d context');
  ctx.imageSmoothingEnabled = false;

  const status = el<HTMLElement>('status');
  status.textContent = 'loading…';

  // Backgrounds carry the palette the blocks are shaded from, so this must load before
  // anything is drawn.
  const backgrounds: QImage[] = [];
  for (let i = 0; i < 10; i++) backgrounds.push(await loadQimg(`assets/fond${i}.qimg`));

  const fb = new Framebuffer();
  const keyboard = new Keyboard();

  let game: Game;
  let currentLevel = -1;

  const startGame = () => {
    game = new Game({ seed: Date.now() & 0x7fffffff, level: 1, levelUp: true, shadow: true });
    keyboard.attach(window, game.canvas);
    currentLevel = -1;
  };
  startGame();

  const scoreEl = el('score');
  const linesEl = el('lines');
  const levelEl = el('level');
  const chainEl = el('chain');

  let bestChain = 0;
  let last = performance.now();

  const render = () => {

    // Level changes swap the background and its palette, exactly as Canvas::change_level
    // does in the original.
    if (game.canvas.level !== currentLevel) {
      currentLevel = game.canvas.level;
      const bg = backgrounds[(currentLevel - 1) % 10]!;
      fb.setPalette(bg.palette);
      fb.putImage(bg.indices, bg.width, bg.height, 0, 0);
    }

    const bg = backgrounds[(currentLevel - 1) % 10]!;
    drawBoard(fb, bg, game.canvas);
    if (game.canvas.blocShadow) drawFallingPiece(fb, game.canvas.blocShadow, true);
    if (game.canvas.bloc) drawFallingPiece(fb, game.canvas.bloc);

    // Previews sit in the header strip above the board, nearest one smallest.
    drawPreview(fb, bg, game.canvas.next3, NEXT3.x, NEXT3.y);
    drawPreview(fb, bg, game.canvas.next2, NEXT2.x, NEXT2.y, true);
    drawPreview(fb, bg, game.canvas.next, NEXT1.x, NEXT1.y, true);
    drawBonusColumn(fb, bg, game.canvas);

    fb.present(ctx);

    bestChain = Math.max(bestChain, game.canvas.complexity);
    scoreEl.textContent = String(game.canvas.score);
    linesEl.textContent = String(game.canvas.linesTot);
    levelEl.textContent = String(game.canvas.level);
    chainEl.textContent = String(bestChain);
    status.textContent = game.isOver ? 'game over — press R to restart' : '';
  };

  const frame = (now: number) => {
    const delta = Math.min(now - last, 250);
    last = now;
    if (!game.isOver) game.advance(delta);
    render();
    requestAnimationFrame(frame);
  };

  /* Dev hook. requestAnimationFrame is throttled to a stop in a background tab, so
   * automated checks cannot drive the game through the normal loop. This exposes a way to
   * advance a fixed number of simulation frames and redraw, which also makes the game
   * reproducible when debugging by hand. */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__quadra = {
      get game() {
        return game;
      },
      step(frames = 1) {
        for (let i = 0; i < frames; i++) {
          game.beginRenderFrame();
          game.step();
        }
        render();
        return {
          score: game.canvas.score,
          lines: game.canvas.linesTot,
          level: game.canvas.level,
          frame: game.frame,
          over: game.isOver,
        };
      },
      /** Place a specific piece and hard-drop it — for reproducing captured positions. */
      place(piece: number, rot: number, col: number) {
        const probe = new Bloc(piece, -1, 0, 0);
        probe.rot = rot;
        let leftmost = 4;
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 4; c++) if (probe.grid()[r]![c]) leftmost = Math.min(leftmost, c);
        const b = new Bloc(piece, -1, 4 + col - leftmost, 10);
        b.rot = rot;
        // Reject placements that do not fit. Without this the piece overlaps a wall,
        // never descends, and gets stamped in mid-air — a state normal play cannot reach.
        if (game.canvas.checkCollide(b.quel, b.bx, b.by, b.rot)) return false;
        game.canvas.bloc = b;
        while (!game.canvas.checkCollide(b.quel, b.bx, b.by + 1, b.rot)) b.by++;
        b.calcXY();
        return true;
      },
      press(action: number) {
        game.canvas.pressKey(action);
      },
      release(action: number) {
        game.canvas.releaseKey(action);
      },
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
      keyboard.dispose();
      bestChain = 0;
      startGame();
    }
    if (e.code === 'KeyP') game.paused = !game.paused;
  });

  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `error: ${String(err)}`;
  console.error(err);
});
