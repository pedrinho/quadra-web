/*
 * Watching a run back.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The viewer owns no simulation of its own: it drives a `TapePlayer`, which re-simulates from
 * the tape, and draws through the same `Screen` the live game uses. Seeking backwards restarts
 * the game and replays to the target, which sounds expensive and is not — a whole run is a few
 * milliseconds of engine work.
 *
 * Playback is paced against the tape's own clock, not the display's. A frame carries the
 * number of 10 ms ticks it ran, so the viewer spends that much time on it whatever the monitor
 * is doing; on a 144 Hz screen a 60 fps recording still plays at the speed it was played.
 */

import type { Game } from '../engine/game.js';
import { TICK_MS } from '../engine/game.js';
import { TapePlayer } from '../replay/playback.js';
import type { Tape } from '../replay/tape.js';
import type { Screen } from '../render/screen.js';
import { ReplayAudio } from '../audio/replay-audio.js';
import type { SoundPlayer } from '../audio/sound-player.js';

/**
 * Something the transport can drive: a game, a position in it, and a way to move.
 *
 * Both `TapePlayer` and `RecPlayer` are one. The viewer deliberately knows nothing about which
 * it has — a tape and a 1998 `.rec` are different files recording different things, but by the
 * time either reaches here it is a re-simulation being stepped, and there is nothing left for
 * the scrubber, the speed control or the sound to tell apart.
 */
export interface ReplaySource {
  readonly game: Game;
  readonly index: number;
  readonly length: number;
  readonly done: boolean;
  /** Cost of the frame at `index`, in 10 ms ticks — how long the viewer dwells on it. */
  ticksAt(index: number): number;
  step(): boolean;
  seek(frame: number): void;
}

export interface ReplayViewerOptions {
  host: HTMLElement;
  screen: Screen;
  /**
   * The sound to play a watched run through, read lazily because the bank loads after the
   * viewer is built. Omitted, a replay is silent and its queue is still drained.
   */
  sounds?: () => SoundPlayer | null;
  /**
   * Whether sound is currently off, and how to turn it on and off — the transport carries the
   * control, the host owns the setting. Omitted, no control is shown.
   */
  muting?: {
    isMuted: () => boolean;
    toggle: () => void;
  };
  /** Called when the viewer opens (true) and closes (false), so the host can pause and redraw. */
  onVisibility?: (open: boolean) => void;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export class ReplayViewer {
  private readonly root: HTMLElement;
  private readonly screen: Screen;
  private readonly onVisibility: ((open: boolean) => void) | undefined;

  private readonly title: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly readout: HTMLElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly muteButton: HTMLButtonElement | null;
  private readonly muting: ReplayViewerOptions['muting'];

  private readonly audio: ReplayAudio;
  private player: ReplaySource | null = null;
  private playing = false;
  private speed = 1;
  private budget = 0;
  private last = 0;
  private raf = 0;

  constructor(opts: ReplayViewerOptions) {
    this.screen = opts.screen;
    this.onVisibility = opts.onVisibility;
    this.muting = opts.muting;
    const sounds = opts.sounds;
    this.audio = new ReplayAudio(sounds ?? (() => null));

    this.root = document.createElement('div');
    this.root.className = 'overlay replay';
    this.root.hidden = true;

    this.title = document.createElement('h2');
    this.playButton = button('▶', () => this.toggle());
    this.playButton.className = 'transport';
    this.speedButton = button('1×', () => this.cycleSpeed());
    this.readout = document.createElement('div');
    this.readout.className = 'readout';

    this.scrub = document.createElement('input');
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.step = '1';
    this.scrub.value = '0';
    this.scrub.addEventListener('input', () => {
      // Read the target *before* pausing: pausing re-renders, and the render writes the
      // current frame back into this very input. Reading after would seek to where the
      // replay already was and the thumb would snap back under the pointer.
      const target = Number(this.scrub.value);
      this.pause();
      this.seek(target);
    });

    const close = button('×', () => this.hide());
    close.className = 'close';
    close.setAttribute('aria-label', 'Close');
    const head = document.createElement('header');
    head.append(this.title, close);

    // Sound that cannot be turned off from the page it is playing on is a defect, and the
    // records page carries no settings panel — so the control lives with the transport.
    this.muteButton = this.muting ? button('', () => this.toggleMute()) : null;
    if (this.muteButton) this.muteButton.className = 'mute';

    const transport = document.createElement('div');
    transport.className = 'transport-row';
    transport.append(this.playButton, this.scrub, this.speedButton);
    if (this.muteButton) transport.append(this.muteButton);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Space plays and pauses, ← and → step a second, Esc closes.';

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.append(head, transport, this.readout, hint);
    this.root.append(panel);
    opts.host.append(this.root);

    // Capture phase, so the game never sees the keys while a replay is up.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** The level the watched run has reached, or 0 with nothing open. */
  get level(): number {
    return this.player?.game.canvas.level ?? 0;
  }

  /** Show `tape`, described by `label`, from the beginning. */
  show(tape: Tape, label: string): void {
    this.showSource(new TapePlayer(tape, { checkpoints: true }), label);
  }

  /**
   * Show anything steppable, described by `label`, from the beginning.
   *
   * The seam a 1998 `.rec` arrives through — it is not a tape and is never made into one, so it
   * cannot come in above. See replay/rec.ts.
   */
  showSource(source: ReplaySource, label: string): void {
    this.player = source;
    // A fresh game arrives with the queue its construction filled, as a live one does.
    this.audio.reset();
    this.title.textContent = label;
    this.scrub.max = String(this.player.length);
    this.scrub.value = '0';
    this.speed = 1;
    this.root.hidden = false;
    this.screen.invalidate();
    this.draw();
    this.onVisibility?.(true);
    this.play();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.pause();
    this.player = null;
    this.root.hidden = true;
    this.screen.invalidate();
    this.onVisibility?.(false);
  }

  dispose(): void {
    this.pause();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  /* --- transport ----------------------------------------------------------- */

  play(): void {
    if (this.playing || !this.player) return;
    if (this.player.done) this.seek(0);
    this.playing = true;
    this.budget = 0;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.render();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.render();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(frame: number): void {
    if (!this.player) return;
    // Said out loud, because a forward seek is indistinguishable from playing: same game, clock
    // moving the same way. Without this, scrubbing forward fires every sound it skipped over.
    this.audio.reset();
    this.player.seek(frame);
    this.draw();
  }

  private toggleMute(): void {
    this.muting?.toggle();
    this.render();
  }

  private cycleSpeed(): void {
    const next = SPEEDS[(SPEEDS.indexOf(this.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    this.speed = next ?? 1;
    this.render();
  }

  private readonly tick = (now: number): void => {
    const player = this.player;
    if (!player || !this.playing) return;

    // Clamped for the same reason the game loop clamps: a tab that was hidden for a minute
    // should resume, not fast-forward through the run.
    this.budget += Math.min(now - this.last, 250) * this.speed;
    this.last = now;

    let guard = 100_000;
    while (!player.done && guard-- > 0) {
      const cost = player.ticksAt(player.index) * TICK_MS;
      if (cost > this.budget) break;
      this.budget -= cost;
      player.step();
    }

    // Here rather than in draw(), which seek() also calls: a seek is the one moment that must
    // stay silent, and it draws like any other frame.
    this.audio.follow(player.game);

    this.draw();
    if (player.done) this.pause();
    else this.raf = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    if (!this.player) return;
    this.screen.scrollers?.follow(this.player.game);
    this.screen.draw(this.player.game.canvas);
    this.render();
  }

  private render(): void {
    const player = this.player;
    if (!player) return;
    this.playButton.textContent = this.playing ? '❚❚' : '▶';
    this.speedButton.textContent = `${this.speed}×`;
    if (this.muteButton && this.muting) {
      const muted = this.muting.isMuted();
      this.muteButton.textContent = muted ? '🔇' : '🔊';
      this.muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      this.muteButton.setAttribute('aria-pressed', String(muted));
    }
    this.scrub.value = String(player.index);
    const seconds = (player.game.ticks * TICK_MS) / 1000;
    this.readout.textContent =
      `frame ${player.index} / ${player.length} · ${seconds.toFixed(1)}s · ` +
      `score ${player.game.canvas.score} · ${player.game.canvas.linesTot} lines · ` +
      `level ${player.game.canvas.level}`;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen || !this.player) return;
    switch (e.code) {
      case 'Escape':
        this.hide();
        break;
      case 'Space':
        this.toggle();
        break;
      case 'ArrowLeft':
        this.pause();
        this.seek(Math.max(0, this.player.index - 60));
        break;
      case 'ArrowRight':
        this.pause();
        this.seek(Math.min(this.player.length, this.player.index + 60));
        break;
      default:
        return;
    }
    e.preventDefault();
    // Immediate, not just `stopPropagation`: every overlay listens on `window`, and listeners
    // on the node an event was dispatched at all run regardless of propagation. Without this
    // one Escape closes the viewer, reopens the board, and is then eaten by the board's own
    // handler and the host's settings hotkey — all from a single keypress.
    e.stopImmediatePropagation();
  };
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}
