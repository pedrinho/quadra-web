/*
 * The stage, before you press play: a run playing itself back.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Not a video and not a loop of screenshots — the engine re-simulating a recording, on the same
 * canvas the game uses, at the speed it was played. It is the page's only ambient motion, and it
 * is also the page's argument: what you are watching is what the leaderboard stores.
 *
 * It shows the best run in this browser, or a recording shipped with the build when there is
 * none yet, and the facts beside it come from verifying that recording rather than from anything
 * written down.
 */

import { TICK_MS } from '../engine/game.js';
import type { Screen } from '../render/screen.js';
import { TapePlayer } from '../replay/playback.js';
import type { Tape } from '../replay/tape.js';
import { verify } from '../replay/verify.js';
import { formatDuration } from './format.js';

/** The caption under the board, and the button that opens what it is playing full size. */
export interface HeroElements {
  section: HTMLElement;
  title: HTMLElement;
  score: HTMLElement;
  by: HTMLElement;
  facts: HTMLElement;
  watch: HTMLElement;
}

export interface HeroSource {
  tape: Tape;
  bytes: Uint8Array;
  /** True when this is the recording shipped with the build rather than one off the board. */
  bundled: boolean;
  /** Who played it, when it came off the board. */
  by?: string;
}

/** A beat of stillness at the end before it starts over, so the last board can be read. */
const REST_MS = 1600;

export class Hero {
  private player: TapePlayer | null = null;
  private source: HeroSource | null = null;
  private playing = false;
  private visible = true;
  private raf = 0;
  private budget = 0;
  private last = 0;
  private restingUntil = 0;

  constructor(
    private readonly screen: Screen,
    private readonly els: HeroElements,
  ) {
    // Nothing is gained by simulating a replay nobody is looking at.
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver(
        ([entry]) => {
          this.visible = entry?.isIntersecting ?? true;
          if (this.visible) this.resume();
          else this.suspend();
        },
        { threshold: 0.05 },
      ).observe(els.section);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.suspend();
      else this.resume();
    });
  }

  get current(): HeroSource | null {
    return this.source;
  }

  /** Point the stage at a recording and describe it from what the verifier says about it. */
  show(source: HeroSource): void {
    this.source = source;
    this.player = new TapePlayer(source.tape, { checkpoints: false });
    this.screen.invalidate();

    // Described from what the verifier reaches, not from anything stored beside the tape. The
    // caption is for someone who has not played yet, so it carries the score, who set it and
    // three facts a player recognises — not the seed or the engine's working.
    const result = verify(source.bytes);
    if (result.ok) {
      this.els.score.textContent = result.score.toLocaleString();
      this.els.facts.replaceChildren(
        fact(`${result.lines} ${result.lines === 1 ? 'line' : 'lines'}`),
        fact(`Level ${result.level}`),
        fact(formatDuration(result.simulatedMs / 1000)),
      );
    } else {
      this.els.score.textContent = '—';
      this.els.facts.replaceChildren(fact(`This recording does not verify (${result.code}).`));
    }

    this.els.title.textContent = source.bundled
      ? 'A demonstration run'
      : 'The record to beat';
    this.els.by.textContent = !source.bundled && source.by ? source.by : '';
    this.els.watch.textContent = source.bundled ? 'Watch the demo' : 'Watch the record';

    this.restart();
  }

  private restart(): void {
    this.player?.seek(0);
    this.budget = 0;
    this.restingUntil = 0;
    this.draw();
  }

  start(): void {
    if (this.playing || !this.player) return;
    this.playing = true;
    this.last = performance.now();
    this.tick(this.last);
  }

  /** Stop and give the canvas back — the game is about to use it. */
  stop(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  private suspend(): void {
    if (this.playing) {
      cancelAnimationFrame(this.raf);
      this.playing = false;
      this.wasPlaying = true;
    }
  }

  private wasPlaying = false;

  private resume(): void {
    if (this.wasPlaying && this.visible && !document.hidden) {
      this.wasPlaying = false;
      this.start();
    }
  }

  private readonly tick = (now: number): void => {
    const player = this.player;
    if (!player || !this.playing) return;
    this.raf = requestAnimationFrame(this.tick);

    const elapsed = Math.min(now - this.last, 250);
    this.last = now;

    if (this.restingUntil) {
      if (now >= this.restingUntil) this.restart();
      return;
    }

    // Paced by the recording's own clock — a frame is worth the ticks it ran — so a 144 Hz
    // display shows it at the speed it happened rather than twice as fast.
    this.budget += elapsed;
    let guard = 10_000;
    while (!player.done && guard-- > 0) {
      const cost = (player.tape.frames[player.index]?.ticks ?? 0) * TICK_MS;
      if (cost > this.budget) break;
      this.budget -= cost;
      player.step();
    }

    // The attract loop is deliberately silent — it starts without a gesture, so the mixer would
    // drop it anyway, and sound nobody asked for is hostile. But the queue is an output, and
    // one nobody listens to grows for every tick of a loop that never ends. `verify.ts` drops
    // it for the same reason.
    player.game.drainSounds();

    this.draw();
    if (player.done) this.restingUntil = now + REST_MS;
  };

  private draw(): void {
    if (!this.player) return;
    this.screen.scrollers?.follow(this.player.game);
    this.screen.draw(this.player.game.canvas);
  }

  /** Draw one frame without running: for a first paint, or when motion is not wanted. */
  paint(): void {
    this.draw();
  }
}

function fact(text: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}
