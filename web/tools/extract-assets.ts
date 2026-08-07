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
 * The originals are not vendored here, so this needs a checkout of upstream Quadra:
 *
 *   git clone https://github.com/quadra-game/quadra ../../quadra-upstream
 *   QUADRA_SRC=../../quadra-upstream npm run assets
 *
 * Its output is committed, so this only has to be run when the asset set changes.
 *
 * Output in public/assets/:
 *   <name>.qimg   "QIMG"  uint16 width  uint16 height  768 B RGB palette  w*h indices
 *   <name>.qfnt   "QFNT"  uint16 glyphs  uint16 shrink  then per glyph:
 *                 uint16 width (0 if absent)  uint16 height  uint16 stride  uint8 pixels[]
 *   sounds.qsnd   "QSND"  uint16 count  then per entry:
 *                 uint8 nameLen  name  uint32 rate  uint32 length  uint8 pcm[length]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { SOUND_FILES } from '../src/audio/sounds.js';
import {
  decodeIndexedPng,
  encodeQimg,
  decodeWav,
  encodeQsnd,
  decodeFnt,
  encodeQfnt,
  type WavPcm,
} from './codecs.js';

const OUT = new URL('../public/assets', import.meta.url).pathname;
const SRC = process.env.QUADRA_SRC ?? process.argv[2];

/*
 * fond0-9 are the per-level playfield backdrops, and each carries the palette the blocks are
 * shaded from.
 *
 * The rest is what the page is built out of. `debuto` is the main menu screen exactly as it
 * shipped, and the page takes two things from it: the chrome QUADRA logo across the top, and
 * the background that `debut0` — the yellow "SINGLE-PLAYER GAME" lettering — was composed over,
 * which is what makes it possible to cut that lettering out (see render/lettering.ts). `debut8`
 * is the Ludus Design signature. `gamepaus` is the badge laid over a paused board, and `multi`
 * is a photograph with nothing painted on it, used as texture behind the stage.
 *
 * Only what is used is converted. The rest of the menu labels and the highscore screen belong
 * to the original's own menus, which this port does not reproduce.
 */
const WANTED = [
  ...Array.from({ length: 10 }, (_, i) => `images/fond${i}.png`),
  'images/black.png',
  'images/debuto.png',
  'images/debut0.png',
  'images/debut8.png',
  'images/gamepaus.png',
  'images/multi.png',
];

/* A missing upstream checkout has to be fatal. The per-file skips below are fine for one
 * absent sample, but silently writing an empty bank from a wrong path would overwrite
 * assets that nothing else in this repository can reproduce. */
if (!SRC || !existsSync(join(SRC, WANTED[0]!))) {
  console.error(
    SRC
      ? `no Quadra source tree at ${SRC} (expected ${WANTED[0]} under it)`
      : 'set QUADRA_SRC to a checkout of upstream Quadra, or pass it as the first argument',
  );
  console.error('  git clone https://github.com/quadra-game/quadra ../../quadra-upstream');
  console.error('  QUADRA_SRC=../../quadra-upstream npm run assets');
  process.exit(1);
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let total = 0;
for (const rel of WANTED) {
  const src = join(SRC, rel);
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

/* The two interface faces (source/fonts.cc:26-35). `shrink` is how much each glyph overlaps
 * the next: 2 for the proportional face the interface writes in, 1 for the monospaced one the
 * original reserves for numbers, so a column of scores lines up. */
for (const [name, shrink] of [
  ['font', 2],
  ['courrier', 1],
] as const) {
  const fntSrc = join(SRC, 'fonts', `${name}.fnt`);
  if (!existsSync(fntSrc)) {
    console.warn(`  skip fonts/${name}.fnt (missing)`);
    continue;
  }
  const glyphs = decodeFnt(readFileSync(fntSrc));
  const bytes = encodeQfnt(glyphs, shrink);
  writeFileSync(join(OUT, `${name}.qfnt`), bytes);
  total += bytes.length;
  const drawn = glyphs.filter((g) => g.width > 0).length;
  console.log(`  ${name.padEnd(10)} ${drawn} glyphs  ${(bytes.length / 1024) | 0} KB`);
}

const sounds = new Map<string, WavPcm>();
for (const name of SOUND_FILES) {
  const src = join(SRC, 'sons', `${name}.wav`);
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
console.log('these are committed — remember to commit the change');
