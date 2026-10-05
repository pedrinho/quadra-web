/*
 * Port of the software mixer in source/sound.cc.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The original writes its own 8-voice mixer onto a raw SDL_OpenAudio callback. Web Audio
 * does the mixing, so what is ported is the *policy*: how many voices, what happens when
 * they run out, and how volume, pan and pitch are derived.
 *
 * The one deliberate divergence is the pan law. The original attenuates the opposite
 * channel linearly (sound.cc:350-360, :202-208); StereoPannerNode is equal-power, so a
 * hard-panned sound sits slightly differently. Reimplementing the linear law would mean a
 * splitter/merger pair per voice for a difference nobody can hear.
 */

import type { SoundBuffer } from './sound-bank.js';

/**
 * Simultaneous voices — `MAXVOICES`, source/sound.cc:33.
 *
 * `Sound::start` (sound.cc:257-267) has no priority and no voice stealing: when all eight
 * are busy the new sound is simply dropped. That is audible, and worth keeping — it is why
 * the original thins out during a big cascade instead of turning to mush.
 */
export const MAX_VOICES = 8;

/** Volume is `-4096..0`, 0 being full. Below the floor is silence. */
export const VOLUME_FLOOR = -4096;
/** Pan runs `-4096..4096`. Positive is right, as in the original. */
export const PAN_RANGE = 4096;

/**
 * The load-time headroom cut the original bakes into every sample (`VOLUMESHIFT` 2,
 * source/sound.cc:30-35) so that eight voices can sum without clipping.
 */
export const HEADROOM = 0.25;

export interface Mixer {
  /**
   * `Sample::play` — source/sound.cc:333-344.
   *
   * @param vol  `-4096..0`, 0 is full volume. Linear, not dB.
   * @param pan  `-4096..4096`, negative left.
   * @param freq Playback rate in Hz, taken against the sample's *original* rate.
   */
  play(sound: SoundBuffer, vol: number, pan: number, freq: number): void;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** A Mixer that discards everything — used when audio is unavailable. */
export const SILENT_MIXER: Mixer = { play: () => {} };

export class WebAudioMixer implements Mixer {
  private readonly master: GainNode;
  /** An OfflineAudioContext only "runs" during startRendering, so it skips the live guard. */
  private readonly offline: boolean;
  private voices = 0;
  private volume = 1;

  constructor(private readonly ctx: BaseAudioContext) {
    this.offline = 'startRendering' in ctx;
    this.master = ctx.createGain();
    this.master.gain.value = HEADROOM;
    this.master.connect(ctx.destination);
  }

  /** Master volume, 0-100. */
  setVolume(percent: number): void {
    this.volume = clamp(percent, 0, 100) / 100;
    this.master.gain.value = HEADROOM * this.volume;
  }

  /**
   * Browsers start an AudioContext suspended until a user gesture. Safe to call repeatedly.
   */
  async resume(): Promise<void> {
    const ctx = this.ctx as Partial<AudioContext>;
    if (!this.offline && ctx.state === 'suspended' && ctx.resume) await ctx.resume();
  }

  play(sound: SoundBuffer, vol: number, pan: number, freq: number): void {
    // A suspended live context does not advance its clock, so anything started now would
    // pile up and fire together the moment audio is unlocked. The game runs before the
    // player touches anything, so this is reachable on every page load.
    if (!this.offline && this.ctx.state !== 'running') return;
    // Drop rather than steal, exactly as source/sound.cc:264.
    if (this.voices >= MAX_VOICES) return;
    if (vol <= VOLUME_FLOOR) return;

    const source = this.ctx.createBufferSource();
    source.buffer = sound.buffer;
    // The original resamples by a ratio against the file's own rate, so a sample recorded
    // at 22050 and asked for 11000 plays an octave down.
    source.playbackRate.value = freq / sound.sampleRate;

    const gain = this.ctx.createGain();
    // `vo = (vol + 4096) >> 4` then `(sample * vo) >> 8` — linear (sound.cc:346-348, :201).
    gain.gain.value = (clamp(vol, VOLUME_FLOOR, 0) + PAN_RANGE) / PAN_RANGE;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -PAN_RANGE, PAN_RANGE) / PAN_RANGE;

    source.connect(gain).connect(panner).connect(this.master);

    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    source.start();
  }
}

/**
 * Build a mixer, or fall back to silence. Audio is a nicety: a browser without Web Audio,
 * or a missing asset bank, must still leave the game playable.
 */
export function createMixer(): { mixer: Mixer; ctx: AudioContext | null } {
  const Ctor =
    typeof globalThis.AudioContext !== 'undefined' ? globalThis.AudioContext : undefined;
  if (!Ctor) return { mixer: SILENT_MIXER, ctx: null };
  try {
    const ctx = new Ctor();
    return { mixer: new WebAudioMixer(ctx), ctx };
  } catch {
    return { mixer: SILENT_MIXER, ctx: null };
  }
}
