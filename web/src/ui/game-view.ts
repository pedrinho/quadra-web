/*
 * The stage while you are playing: the board, and the readouts beside it.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The score, the level and the rest are page elements rather than pixels in the framebuffer.
 * The original had to paint them into its own 640x480 surface; a web page does not, and putting
 * them in the document means they are selectable, readable to a screen reader, and legible at
 * whatever size the browser is.
 */

import type { Game } from '../engine/game.js';

export interface GameViewElements {
  attract: HTMLElement;
  hud: HTMLElement;
  state: HTMLElement;
  score: HTMLElement;
  lines: HTMLElement;
  level: HTMLElement;
  chain: HTMLElement;
}

export class GameView {
  private bestChain = 0;

  constructor(private readonly els: GameViewElements) {}

  /** Swap the stage between the attract replay and a game in progress. */
  show(playing: boolean): void {
    this.els.attract.hidden = playing;
    this.els.hud.hidden = !playing;
    if (playing) this.reset();
    else this.clearState();
  }

  reset(): void {
    this.bestChain = 0;
    this.clearState();
    this.els.score.textContent = '0';
    this.els.lines.textContent = '0';
    this.els.level.textContent = '1';
    this.els.chain.textContent = '0';
  }

  update(game: Game): void {
    this.bestChain = Math.max(this.bestChain, game.canvas.complexity);
    this.els.score.textContent = game.canvas.score.toLocaleString();
    this.els.lines.textContent = String(game.canvas.linesTot);
    this.els.level.textContent = String(game.canvas.level);
    this.els.chain.textContent = String(this.bestChain);
  }

  /** A word over the board — paused, or what happened to the run that just ended. */
  setState(headline: string, detail = ''): void {
    this.els.state.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = headline;
    this.els.state.append(strong);
    if (detail) {
      const span = document.createElement('span');
      span.textContent = detail;
      this.els.state.append(span);
    }
    this.els.state.hidden = false;
  }

  clearState(): void {
    this.els.state.hidden = true;
    this.els.state.replaceChildren();
  }
}
