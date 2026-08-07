/*
 * The original's bitmap lettering.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Port of `Fontdata` and `Font` (source/sprite.cc:58-245). Two ideas from the original are
 * worth keeping straight:
 *
 * A glyph does not store colours. It stores intensities 0-7, and a `Font` resolves those
 * against a particular palette when it is built (`Font::colorize`). One face therefore draws
 * white on the menu, yellow on the row you just beat, and both are the same 22 KB of glyphs.
 * It also means a font belongs to a palette: swap the screen and the fonts are rebuilt.
 *
 * Glyph slot n is the character n + 33, so the table starts at '!'. Space has no glyph at all;
 * it advances by the width of an 'i', which is the original's rule and not an approximation.
 */

import type { Framebuffer } from './framebuffer.js';

export type Rgb = readonly [number, number, number];

export interface Glyph {
  width: number;
  height: number;
  stride: number;
  pixels: Uint8Array;
}

/** The first character with a glyph. Everything below it is a space or a control code. */
const FIRST_CHAR = 33;
/** An unknown or non-printable character advances like this one, per `Fontdata::width`. */
const FALLBACK = 'i'.charCodeAt(0) - FIRST_CHAR;

export class Fontdata {
  /** Advance per slot: the glyph's width less the overlap, and never less than three. */
  private readonly advance: Int32Array;

  constructor(
    readonly glyphs: readonly (Glyph | null)[],
    readonly shrink: number,
  ) {
    this.advance = new Int32Array(glyphs.length);
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      this.advance[i] = g ? Math.max(g.width - shrink, 3) : 0;
    }
  }

  /** Tallest glyph. The original reads slot 1's height and calls it the line height. */
  get height(): number {
    return this.glyphs[1]?.height ?? 0;
  }

  slot(code: number): number {
    const i = code - FIRST_CHAR;
    return i >= 0 && i < this.glyphs.length && this.glyphs[i] ? i : -1;
  }

  advanceOf(slot: number): number {
    return this.advance[slot === -1 ? FALLBACK : slot] ?? 0;
  }

  width(text: string): number {
    let w = 0;
    for (const ch of text) w += this.advanceOf(this.slot(ch.codePointAt(0) ?? 32));
    return w + this.shrink;
  }
}

export function decodeQfnt(buf: ArrayBuffer): Fontdata {
  const view = new DataView(buf);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'QFNT') throw new Error(`not a .qfnt file (magic "${magic}")`);

  const count = view.getUint16(4, true);
  const shrink = view.getUint16(6, true);
  const glyphs: (Glyph | null)[] = [];
  let pos = 8;
  for (let i = 0; i < count; i++) {
    const width = view.getUint16(pos, true);
    pos += 2;
    if (width === 0) {
      glyphs.push(null);
      continue;
    }
    const height = view.getUint16(pos, true);
    const stride = view.getUint16(pos + 2, true);
    pos += 4;
    const pixels = new Uint8Array(buf, pos, stride * height);
    pos += stride * height;
    glyphs.push({ width, height, stride, pixels });
  }
  return new Fontdata(glyphs, shrink);
}

export async function loadQfnt(url: string): Promise<Fontdata> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status} ${res.statusText}`);
  return decodeQfnt(await res.arrayBuffer());
}

/**
 * Nearest colour in a palette, by the original's weighting: green counts triple and red
 * double, because that is roughly how much the eye cares (`Remap::findrgb`,
 * source/palette.cc:58-72). Index 0 is skipped — it is the transparency key.
 */
export function findRgb(palette: Uint8Array, r: number, g: number, b: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 1; i < 256; i++) {
    const dr = palette[i * 3]! - r;
    const dg = palette[i * 3 + 1]! - g;
    const db = palette[i * 3 + 2]! - b;
    const diff = dr * dr * 2 + dg * dg * 3 + db * db;
    if (diff === 0) return i;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/** A face bound to a palette and a colour. Cheap enough to rebuild on every screen change. */
export class Font {
  /** Palette index per glyph intensity, 0 unused because 0 never draws. */
  private readonly ramp = new Uint8Array(8);

  constructor(
    readonly data: Fontdata,
    palette: Uint8Array,
    color: Rgb,
    shadow: Rgb = [0, 0, 0],
  ) {
    // An eight-step ramp from the shadow colour to the full one, exactly as `Font::colorize`
    // builds it. The glyphs are anti-aliased against that ramp, so text picks up an outline
    // on a busy photographic background instead of dissolving into it.
    for (let i = 0; i < 8; i++) {
      const mix = (a: number, b: number) => Math.floor((a * (7 - i) + b * i) / 7);
      this.ramp[i] = findRgb(
        palette,
        mix(shadow[0], color[0]),
        mix(shadow[1], color[1]),
        mix(shadow[2], color[2]),
      );
    }
  }

  get height(): number {
    return this.data.height;
  }

  width(text: string): number {
    return this.data.width(text);
  }

  /** Draw at the top-left of the text box. Returns the x the next character would take. */
  draw(fb: Framebuffer, text: string, x: number, y: number): number {
    for (const ch of text) {
      const slot = this.data.slot(ch.codePointAt(0) ?? 32);
      const glyph = slot === -1 ? null : this.data.glyphs[slot];
      if (glyph) {
        for (let gy = 0; gy < glyph.height; gy++) {
          const row = gy * glyph.stride;
          for (let gx = 0; gx < glyph.width; gx++) {
            const v = glyph.pixels[row + gx]!;
            if (v !== 0) fb.putPel(x + gx, y + gy, this.ramp[v & 7]!);
          }
        }
      }
      x += this.data.advanceOf(slot);
    }
    return x;
  }

  /** Centred in a box, as `Font::draw` does for its CENTER sentinel. */
  drawCentered(fb: Framebuffer, text: string, y: number, x = 0, width = fb.width): number {
    return this.draw(fb, text, x + ((width - this.width(text)) >> 1), y);
  }

  /** Right-aligned, which is how the original sets a column of scores. */
  drawRight(fb: Framebuffer, text: string, right: number, y: number): number {
    return this.draw(fb, text, right - this.width(text), y);
  }
}
