/*
 * What the page says about a game in progress: the readouts in the panel, the line under the
 * board, and what became of the run when it pauses or ends.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The score, the level and the rest are page elements rather than pixels in the framebuffer.
 * The original had to paint them into its own 640x480 surface; a web page does not, and putting
 * them in the document means they are selectable, readable to a screen reader, and legible at
 * whatever size the browser is.
 *
 * None of it goes over the board. A finished run greys out with the original's wipe and a paused
 * one wears the original's badge, and both are worth seeing; the words go under the score instead.
 */

import type { Game } from '../engine/game.js';

/** The last thing a finished run says. */
const AGAIN = 'Press R to play again.';

export interface GameViewElements {
  /** The line under the board while the attract replay plays, and the one while you do. */
  stripAttract: HTMLElement;
  stripGame: HTMLElement;
  stripScore: HTMLElement;
  /** The panel's heading, the line under its score, its first button and its last line. */
  title: HTMLElement;
  state: HTMLElement;
  restart: HTMLElement;
  hint: HTMLElement;
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
    this.setOver(false);
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
   * The run has ended, or a new one has begun. An ended run's score is final, and the next thing
   * to do is play again, so the button that does it becomes the one that stands out. The hint is
   * only written here on the way out: on the way in, `startGame` knows what the run will count for.
   */
  setOver(over: boolean): void {
    this.els.title.textContent = over ? 'Final score' : 'Score';
    this.els.restart.textContent = over ? 'Play again' : 'Restart';
    this.els.restart.classList.toggle('btn-primary', over);
    this.els.restart.classList.toggle('btn-ghost', !over);
    if (over) this.els.hint.textContent = AGAIN;
  }

  /**
   * One line under the score — paused, or what happened to the run that just ended.
   *
   * `link` is how a finished run reaches the row it landed on: the one place that can carry
   * someone to the leaderboard with that row in hand.
   */
  setState(text: string, link?: { href: string; text: string }): void {
    const nodes: Node[] = [document.createTextNode(text)];
    if (link) {
      const anchor = document.createElement('a');
      anchor.className = 'more';
      anchor.href = link.href;
      anchor.dataset['link'] = '';
      anchor.textContent = link.text;
      nodes.push(document.createElement('br'), anchor);
    }
    this.els.state.replaceChildren(...nodes);
  }

  clearState(): void {
    this.els.state.replaceChildren();
  }
}
