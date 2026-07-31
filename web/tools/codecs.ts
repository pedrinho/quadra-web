/*
 * Pure codecs for the asset conversion: the original PNG/WAV in, the port's .qimg/.qsnd out.
 *
 * Kept separate from extract-assets.ts so tests can exercise them without running the
 * script, which writes several megabytes into public/assets as a side effect.
 */

import { inflateSync } from 'node:zlib';

export interface Indexed {
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

export function encodeQimg(img: Indexed): Buffer {
  const header = Buffer.alloc(8);
  header.write('QIMG', 0, 'latin1');
  header.writeUInt16LE(img.width, 4);
  header.writeUInt16LE(img.height, 6);
  return Buffer.concat([header, Buffer.from(img.palette), Buffer.from(img.indices)]);
}

export interface WavPcm {
  rate: number;
  /** Unsigned 8-bit mono samples, exactly as stored in the file. */
  pcm: Uint8Array;
}

/**
 * Read a RIFF WAV. Every file in `sons/` is 8-bit mono PCM (42 at 11025 Hz, 8 at 22050),
 * and the original refuses anything else outright (source/sound.cc:325), so this does too
 * rather than silently mangling an unexpected file.
 */
export function decodeWav(buf: Buffer): WavPcm {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE')
    throw new Error('not a RIFF/WAVE file');

  let rate = 0;
  let channels = 0;
  let bits = 0;
  let pcm: Uint8Array | null = null;

  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);

    if (id === 'fmt ') {
      const format = body.readUInt16LE(0);
      if (format !== 1) throw new Error(`expected PCM, got format ${format}`);
      channels = body.readUInt16LE(2);
      rate = body.readUInt32LE(4);
      bits = body.readUInt16LE(14);
    } else if (id === 'data') {
      pcm = new Uint8Array(body);
    }
    // Chunks are word-aligned, so an odd size carries a pad byte.
    pos += 8 + size + (size & 1);
  }

  if (!pcm) throw new Error('no data chunk');
  if (channels !== 1 || bits !== 8)
    throw new Error(`expected 8-bit mono, got ${bits}-bit ${channels}-channel`);
  return { rate, pcm };
}

export function encodeQsnd(entries: ReadonlyMap<string, WavPcm>): Buffer {
  const head = Buffer.alloc(6);
  head.write('QSND', 0, 'latin1');
  head.writeUInt16LE(entries.size, 4);

  const parts: Buffer[] = [head];
  for (const [name, { rate, pcm }] of entries) {
    const nameBytes = Buffer.from(name, 'latin1');
    if (nameBytes.length > 255) throw new Error(`name too long: ${name}`);
    const meta = Buffer.alloc(1 + nameBytes.length + 8);
    meta.writeUInt8(nameBytes.length, 0);
    nameBytes.copy(meta, 1);
    meta.writeUInt32LE(rate, 1 + nameBytes.length);
    meta.writeUInt32LE(pcm.length, 5 + nameBytes.length);
    parts.push(meta, Buffer.from(pcm));
  }
  return Buffer.concat(parts);
}
