/*
 * What the page says about a game in progress: the readouts in the panel, the line under the
 * board, and the words over it when the game pauses or ends.
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
  /** The line under the board while the attract replay plays, and the one while you do. */
  stripAttract: HTMLElement;
  stripGame: HTMLElement;
  stripScore: HTMLElement;
  state: HTMLElement;
  score: HTMLElement;
  lines: HTMLElement;
  level: HTMLElement;
  chain: HTMLElement;
}

export class GameView {
  private bestChain = 0;

  constructor(private readonly els: GameViewElements) {}

  /** Swap what is under the board between the attract replay and a game in progress. */
  show(playing: boolean): void {
    this.els.stripAttract.hidden = playing;
    this.els.stripGame.hidden = !playing;
    if (playing) this.reset();
    else this.clearState();
  }

  reset(): void {
    this.bestChain = 0;
    this.clearState();
    for (const el of [this.els.score, this.els.stripScore, this.els.lines, this.els.chain]) {
      el.textContent = '0';
    }
    this.els.level.textContent = '1';
  }

  update(game: Game): void {
    this.bestChain = Math.max(this.bestChain, game.canvas.complexity);
    const score = game.canvas.score.toLocaleString();
    this.els.score.textContent = score;
    this.els.stripScore.textContent = score;
    this.els.lines.textContent = String(game.canvas.linesTot);
    this.els.level.textContent = String(game.canvas.level);
    this.els.chain.textContent = String(this.bestChain);
  }

  /**
   * Words over the board — paused, or what happened to the run that just ended — and a line or
   * two under them.
   *
   * `link` is how a finished run reaches the row it landed on: the one place that can carry
   * someone to the leaderboard with that row in hand.
   */
  setState(headline: string, detail: string[] = [], link?: { href: string; text: string }): void {
    this.els.state.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = headline;
    this.els.state.append(strong);
    // A line each: what happened to the run, then what to do next.
    for (const line of detail) {
      const span = document.createElement('span');
      span.textContent = line;
      this.els.state.append(span);
    }
    if (link) {
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.dataset['link'] = '';
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
