/*
 * Extract palette + raw indices from Quadra's 8-bit paletted PNGs.
 *
 * This has to happen at build time. Browsers decode paletted PNGs straight to RGBA and
 * throw the indices away — but the whole rendering model depends on them: block shading
 * reads palette slots 184-255 (Color::shade, source/color.cc:25-32), and the original's
 * level changes and fades work by swapping the palette under fixed indices.
 *
 *   npx vite-node tools/extract-assets.ts
 *
 * Output per image, in public/assets/<name>.qimg:
 *   "QIMG"  uint16 width  uint16 height  768 bytes RGB palette  width*height indices
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, basename } from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;
const OUT = join(REPO, 'web/public/assets');

interface Indexed {
  width: number;
  height: number;
  palette: Uint8Array; // 768 bytes, RGB
  indices: Uint8Array; // width*height
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode an 8-bit colour-type-3 PNG. Only that form is needed; anything else throws. */
export function decodeIndexedPng(buf: Buffer): Indexed {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let palette: Uint8Array | null = null;
  const idat: Buffer[] = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      const colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8 || colorType !== 3)
        throw new Error(`expected 8-bit paletted, got depth ${bitDepth} type ${colorType}`);
      if (interlace !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') {
      palette = new Uint8Array(768);
      palette.set(data.subarray(0, Math.min(768, data.length)));
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (!palette) throw new Error('no PLTE chunk');
  const raw = inflateSync(Buffer.concat(idat));

  // Undo per-scanline filtering. Bytes-per-pixel is 1 for 8-bit indexed, which keeps the
  // Sub/Paeth neighbour lookups to a single byte back.
  const out = new Uint8Array(width * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]!;
    const row = y * width;
    const prev = row - width;
    for (let x = 0; x < width; x++) {
      const value = raw[src + x]!;
      const a = x > 0 ? out[row + x - 1]! : 0;
      const b = y > 0 ? out[prev + x]! : 0;
      const c = x > 0 && y > 0 ? out[prev + x - 1]! : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = value;
          break;
        case 1:
          v = value + a;
          break;
        case 2:
          v = value + b;
          break;
        case 3:
          v = value + ((a + b) >> 1);
          break;
        case 4:
          v = value + paeth(a, b, c);
          break;
        default:
          throw new Error(`row ${y}: unknown PNG filter ${filter}`);
      }
      out[row + x] = v & 0xff;
    }
    src += width;
  }

  return { width, height, palette, indices: out };
}

function encodeQimg(img: Indexed): Buffer {
  const header = Buffer.alloc(8);
  header.write('QIMG', 0, 'latin1');
  header.writeUInt16LE(img.width, 4);
  header.writeUInt16LE(img.height, 6);
  return Buffer.concat([header, Buffer.from(img.palette), Buffer.from(img.indices)]);
}

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
console.log(`\nwrote ${(total / 1024) | 0} KB to web/public/assets/`);
