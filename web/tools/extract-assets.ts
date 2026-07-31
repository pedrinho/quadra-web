/*
 * Convert Quadra's original art and sound into formats the port can load directly.
 *
 * Both conversions have to happen at build time, and for the same underlying reason: the
 * browser's own decoders throw away exactly the information the port needs.
 *
 * Images — browsers decode paletted PNGs straight to RGBA and discard the indices, but the
 * whole rendering model depends on them: block shading reads palette slots 184-255
 * (Color::shade, source/color.cc:25-32), and level changes and fades work by swapping the
 * palette under fixed indices.
 *
 * Sound — `decodeAudioData` resamples to the AudioContext's rate and discards the file's
 * own rate. The original's pitch control *is* a rate ratio (`Playing_sfx`,
 * source/sound.cc:362-369), so the source rate has to survive: `glissup.wav` is 22050 Hz
 * and is played at 11000, an octave down. Keeping the raw 8-bit PCM and its rate lets
 * `createBuffer` reproduce that exactly.
 *
 *   npx vite-node tools/extract-assets.ts
 *
 * Output in public/assets/:
 *   <name>.qimg   "QIMG"  uint16 width  uint16 height  768 B RGB palette  w*h indices
 *   sounds.qsnd   "QSND"  uint16 count  then per entry:
 *                 uint8 nameLen  name  uint32 rate  uint32 length  uint8 pcm[length]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { SOUND_FILES } from '../src/audio/sounds.js';
import { decodeIndexedPng, encodeQimg, decodeWav, encodeQsnd, type WavPcm } from './codecs.js';

const REPO = new URL('../../', import.meta.url).pathname;
const OUT = join(REPO, 'web/public/assets');

/* Backgrounds are all that is needed so far: fond0-9 are the per-level playfield
 * backdrops, and each carries the palette the blocks are shaded from. */
const WANTED = [
  ...Array.from({ length: 10 }, (_, i) => `images/fond${i}.png`),
  'images/black.png',
];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let total = 0;
for (const rel of WANTED) {
  const src = join(REPO, rel);
  if (!existsSync(src)) {
    console.warn(`  skip ${rel} (missing)`);
    continue;
  }
  const img = decodeIndexedPng(readFileSync(src));
  const name = basename(rel, '.png');
  const dest = join(OUT, `${name}.qimg`);
  const bytes = encodeQimg(img);
  writeFileSync(dest, bytes);
  total += bytes.length;
  console.log(`  ${name.padEnd(10)} ${img.width}x${img.height}  ${(bytes.length / 1024) | 0} KB`);
}

const sounds = new Map<string, WavPcm>();
for (const name of SOUND_FILES) {
  const src = join(REPO, 'sons', `${name}.wav`);
  if (!existsSync(src)) {
    console.warn(`  skip sons/${name}.wav (missing)`);
    continue;
  }
  sounds.set(name, decodeWav(readFileSync(src)));
}
if (sounds.size) {
  const bank = encodeQsnd(sounds);
  writeFileSync(join(OUT, 'sounds.qsnd'), bank);
  total += bank.length;
  console.log(`  ${'sounds'.padEnd(10)} ${sounds.size} samples  ${(bank.length / 1024) | 0} KB`);
}

console.log(`\nwrote ${(total / 1024) | 0} KB to web/public/assets/`);
