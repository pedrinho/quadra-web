/*
 * Turns the simulation's sound events into mixer calls.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Every volume, pan and pitch constant here is lifted from the call sites in
 * source/player.cc. The randomness matters as much as the numbers: the original draws it
 * from `ugs_random`, the global RNG, and never from `canvas->rnd`, the seeded game LCG.
 * Reading the game LCG here would advance the piece sequence and desynchronise the
 * simulation, so this class owns its own generator and the engine owns none.
 */

import type { SoundEvent } from '../engine/sound-events.js';
import type { SoundBuffer } from './sound-bank.js';
import type { Mixer } from './mixer.js';
import { GLOBAL_SOUNDS, themeForLevel, type SoundName } from './sounds.js';

/** Uniform integer in `0..max` inclusive — `Random::rnd(int)` in the original. */
export type RandomInt = (max: number) => number;

const defaultRandom: RandomInt = (max) => Math.floor(Math.random() * (max + 1));

export class SoundPlayer {
  /** Level drives the sample theme, as `Canvas::change_level` does. */
  level = 1;

  constructor(
    private readonly bank: ReadonlyMap<string, SoundBuffer>,
    private readonly mixer: Mixer,
    private readonly rnd: RandomInt = defaultRandom,
  ) {}

  play(events: readonly SoundEvent[]): void {
    for (const event of events) this.playOne(event);
  }

  playOne(event: SoundEvent): void {
    const theme = themeForLevel(this.level);
    const rnd = this.rnd;

    switch (event.kind) {
      // source/player.cc:144 and :163 — pan follows the piece's column.
      case 'rotate':
        this.emit(theme.drip, -200 - rnd(127), pan(event.column), 10500 + rnd(1023));
        break;

      // source/player.cc:1564-1576 — one of three landing samples, chosen at random.
      case 'land': {
        const which = rnd(2);
        const sample = which === 0 ? theme.depose : which === 1 ? theme.depose2 : theme.depose3;
        this.emit(sample, -200 - rnd(255), pan(event.column), 10500 + rnd(1023));
        break;
      }

      // source/player.cc:755-762. The pitch drops 256 per chain step — this is the cascade
      // feedback, and the whole reason the game sounds the way it does when a chain runs.
      case 'lineClear':
        this.emit(theme.flash, -300 - rnd(255), -1, 11000 + rnd(127) - (event.chain << 8));
        break;

      // source/player.cc:848-857 — louder the further the stack fell, capped at full.
      case 'cascadeSettled':
        this.emit(
          GLOBAL_SOUNDS.cascade,
          Math.min(0, -500 + event.rowsFallen * 50),
          -1,
          11000 + rnd(127) - (event.chain << 8),
        );
        break;

      // source/player.cc:973-976.
      case 'levelUp':
        this.emit(GLOBAL_SOUNDS.levelUp, -200 - rnd(127), 0, 11000);
        break;

      // source/player.cc:1282. The original repeats this through a multi-frame death wipe;
      // the port reduced that animation to a state change, so it fires once.
      case 'gameOver':
        this.emit(theme.flash, -600, -1, 22500 + rnd(1023));
        break;
    }
  }

  /** `sons.pause` — source/multi_player.cc:256. */
  playPause(): void {
    this.emit(GLOBAL_SOUNDS.pause, -300, 0, 11025);
  }

  /** `sons.start` — source/multi_player.cc:267. */
  playStart(): void {
    this.emit(GLOBAL_SOUNDS.start, -300, 0, 11025);
  }

  private emit(name: SoundName, vol: number, pan: number, freq: number): void {
    const sound = this.bank.get(name);
    // The original guards with `if(this && sound)` (sound.cc:333) so a slot that was never
    // loaded is a silent no-op rather than a crash. Same here for a partial bank.
    if (sound) this.mixer.play(sound, vol, pan, freq);
  }
}

/**
 * `i = (canvas->bloc->bx - 9) * 300` — source/player.cc:143. Column 9 is centre, so the
 * playfield spans roughly -1500..1200 of the mixer's -4096..4096 range.
 */
function pan(column: number): number {
  return (column - 9) * 300;
}
