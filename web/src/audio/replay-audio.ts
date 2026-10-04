/*
 * Sound for a game being watched rather than played.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A replay queues sound events exactly as live play does — it is the same simulation — so giving
 * a watched run its sound is only a question of who drains the queue and when. The "when" is the
 * whole problem: `TapePlayer.seek` re-simulates, so after a scrub the queue holds every event
 * between where the viewer was and where it now is. Handing that to `SoundPlayer.play`, which
 * emits with no time offset, fires all of it at one instant — eight overlapping voices and the
 * rest dropped on the floor.
 *
 * So this mirrors `TextScrollers.follow` (src/render/scrollers.ts), which already solved the same
 * problem for the rising text: a jump is recognised, and what it skipped over is discarded rather
 * than shown all at once. Sound is the louder version of that bug.
 *
 * The queue is drained on every path, including the discarding ones. That is deliberate and is
 * also a fix in its own right: `Game.env.sounds` is a plain array, so a host that never drains
 * accumulates a whole run's events. `verify.ts` drains for exactly this reason.
 */

import type { SoundEvent } from '../engine/sound-events.js';
import type { SoundPlayer } from './sound-player.js';

/**
 * A source of sound to follow. Structurally a `Game`, but written out so the audio layer does
 * not have to depend on the engine's entry point, the same way `NoticeSource` does.
 */
export interface SoundSource {
  /** Ticks simulated so far, so a wind-back is recognisable. */
  readonly ticks: number;
  /** The level decides the sample theme, as `Canvas::change_level` does. */
  readonly canvas: { readonly level: number };
  drainSounds(): SoundEvent[];
}

export class ReplayAudio {
  private source: SoundSource | null = null;
  private ticks = 0;

  /**
   * `sounds` is an accessor rather than a value because the bank loads asynchronously: the
   * hosts that own a viewer are built before the `SoundPlayer` exists, and taking it by value
   * would capture null for the life of the page.
   */
  constructor(private readonly sounds: () => SoundPlayer | null) {}

  /** Play whatever `source` has queued since the last call. */
  follow(source: SoundSource): void {
    // A different game, or the same one wound back. Seeking backwards rebuilds the game from
    // the tape's header, so both look like this from out here.
    const jumped = source !== this.source || source.ticks < this.ticks;
    this.source = source;
    this.ticks = source.ticks;

    const events = source.drainSounds();
    // Everything on the queue happened on the way to this frame, not at it.
    if (jumped) return;

    const player = this.sounds();
    if (!player) return;
    player.level = source.canvas.level;
    player.play(events);
  }

  /**
   * Forget where we were, so the next `follow` discards instead of playing.
   *
   * Seeking *forwards* keeps the same game and moves the clock the same direction a normal frame
   * does, so it is indistinguishable from play here — the transport has to say so itself.
   */
  reset(): void {
    this.source = null;
  }
}
