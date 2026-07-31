/*
 * Loader for the .qsnd bank produced by tools/extract-assets.ts.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Format: "QSND", uint16 count, then per entry:
 *   uint8 nameLen, name, uint32 rate, uint32 length, uint8 pcm[length]
 *
 * The samples keep their *original* rate rather than the AudioContext's. That is the point
 * of not using decodeAudioData: the original's pitch control is a rate ratio
 * (`Playing_sfx`, source/sound.cc:362-369), so `createBuffer(1, n, originalRate)` lets an
 * AudioBufferSourceNode reproduce it with playbackRate alone.
 */

export interface RawSample {
  rate: number;
  /** Unsigned 8-bit mono PCM, as stored in the original WAV. */
  pcm: Uint8Array;
}

export function decodeQsnd(buf: ArrayBuffer): Map<string, RawSample> {
  const view = new DataView(buf);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'QSND') throw new Error(`not a .qsnd file (magic "${magic}")`);

  const count = view.getUint16(4, true);
  const out = new Map<string, RawSample>();
  let pos = 6;

  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint8(pos);
    pos += 1;
    let name = '';
    for (let j = 0; j < nameLen; j++) name += String.fromCharCode(view.getUint8(pos + j));
    pos += nameLen;
    const rate = view.getUint32(pos, true);
    const length = view.getUint32(pos + 4, true);
    pos += 8;
    out.set(name, { rate, pcm: new Uint8Array(buf, pos, length) });
    pos += length;
  }
  return out;
}

/** A decoded sample ready to play. Mirrors the original's `SampleData`. */
export interface SoundBuffer {
  buffer: AudioBuffer;
  /** The WAV's own rate, which the pitch ratio is taken against. */
  sampleRate: number;
}

/**
 * Build AudioBuffers from a decoded bank. 8-bit WAV samples are unsigned with silence at
 * 128, so they centre as `(s - 128) / 128`.
 *
 * The original also shifts everything down by 2 bits at load (`VOLUMESHIFT`,
 * source/sound.cc:269-330) so eight voices can sum without clipping, and inverts the phase
 * as a side effect. The inversion is inaudible and dropped here; the headroom is applied
 * once on the master gain instead, which keeps the sample data full-scale.
 */
export function buildSoundBuffers(
  raw: ReadonlyMap<string, RawSample>,
  ctx: BaseAudioContext,
): Map<string, SoundBuffer> {
  const out = new Map<string, SoundBuffer>();
  for (const [name, { rate, pcm }] of raw) {
    if (!pcm.length) continue;
    const buffer = ctx.createBuffer(1, pcm.length, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i]! - 128) / 128;
    out.set(name, { buffer, sampleRate: rate });
  }
  return out;
}

export async function loadSoundBank(
  url: string,
  ctx: BaseAudioContext,
): Promise<Map<string, SoundBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status} ${res.statusText}`);
  return buildSoundBuffers(decodeQsnd(await res.arrayBuffer()), ctx);
}
