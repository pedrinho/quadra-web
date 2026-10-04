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
import type { Fontdata } from '../render/font.js';
import { letteringCanvas } from '../render/lettering.js';

export interface GameViewElements {
  attract: HTMLElement;
  /** What the attract replay is, under the board. Not true of a game in progress. */
  caption?: HTMLElement;
  hud: HTMLElement;
  state: HTMLElement;
  score: HTMLElement;
  lines: HTMLElement;
  level: HTMLElement;
  chain: HTMLElement;
}

export class GameView {
  private bestChain = 0;

  /**
   * `font` is the game's own bitmap face. The words that go over the board — paused, game over —
   * are the original speaking in-game, so they are set in it. Everything the port says in its
   * own voice stays in the page's web font.
   */
  constructor(
    private readonly els: GameViewElements,
    private readonly font?: Fontdata,
  ) {}

  /** Swap the stage between the attract replay and a game in progress. */
  show(playing: boolean): void {
    this.els.attract.hidden = playing;
    if (this.els.caption) this.els.caption.hidden = playing;
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

  /**
   * A word over the board — paused, or what happened to the run that just ended — and a line or
   * two under it.
   *
   * `link` is how a finished run reaches the board it landed on: the records live on their own
   * page now, so this is the one place that can carry someone there with the row in hand.
   */
  setState(headline: string, detail: string[] = [], link?: { href: string; text: string }): void {
    this.els.state.replaceChildren();
    const strong = document.createElement('strong');
    if (this.font) {
      // The canvas carries the look; the text stays in the document for screen readers, which
      // get nothing out of a bitmap.
      const canvas = letteringCanvas(headline, this.font, {
        color: [255, 255, 255],
        shadow: [0, 20, 40],
      });
      canvas.className = 'lettering-art';
      const label = document.createElement('span');
      label.className = 'vh';
      label.textContent = headline;
      strong.append(canvas, label);
    } else {
      strong.textContent = headline;
    }
    this.els.state.append(strong);
    // A line each: what happened to the run, then what to do next.
    for (const line of detail) {
      const span = document.createElement('span');
      span.textContent = line;
      this.els.state.append(span);
    }
    if (link) {
      const anchor = document.createElement('a');
      anchor.className = 'link';
      anchor.href = link.href;
      anchor.textContent = link.text;
      this.els.state.append(anchor);
    }
    this.els.state.hidden = false;
  }

  clearState(): void {
    this.els.state.hidden = true;
    this.els.state.replaceChildren();
  }
}
