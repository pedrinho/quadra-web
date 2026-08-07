/*
 * The original's artwork, cut out for use on a web page.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Two conversions, both from indexed pixels to RGBA with a real alpha channel:
 *
 * `letteringPixels` sets *any* text in Quadra's own 1998 face. The glyphs store intensities 0-7
 * rather than colours (see render/font.ts), so a heading this page needs but the game never
 * printed can still be set in the game's lettering. That is the difference between using the
 * artwork as material and replaying it.
 *
 * `labelPixels` cuts out the words the original did print — the menu labels, the Ludus Design
 * signature. They are not transparent sprites, so this is a subtraction rather than a key; the
 * comment on the function explains why.
 *
 * All of it is pure so it can be tested without a browser; `toCanvas` and the two `*Canvas`
 * helpers are the thin DOM wrappers the page actually calls.
 */

import type { Fontdata, Rgb } from './font.js';
import type { QImage } from './qimg.js';

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, one byte per channel, premultiplied by nothing. */
  rgba: Uint8ClampedArray;
}

export interface LetteringOptions {
  /** The full-intensity colour. Intensity 1 is the shadow, 7 is this. */
  color?: Rgb;
  shadow?: Rgb;
  /** Blank pixels around the text, so a glow or a shadow has somewhere to sit. */
  padding?: number;
}

/**
 * Set `text` in the bitmap face.
 *
 * The intensity ramp becomes a colour ramp from `shadow` to `color`, exactly as `Font::colorize`
 * does, and every inked pixel is fully opaque. Mapping intensity to *alpha* instead would look
 * like a reasonable idea and would throw away the dark edge that keeps this lettering readable
 * over a photograph.
 */
export function letteringPixels(
  text: string,
  font: Fontdata,
  { color = [255, 255, 255], shadow = [0, 20, 40], padding = 0 }: LetteringOptions = {},
): Pixels {
  const width = Math.max(1, font.width(text) + padding * 2);
  const height = font.height + padding * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);

  const ramp: Rgb[] = [];
  for (let i = 0; i < 8; i++) {
    ramp.push([
      Math.floor((shadow[0] * (7 - i) + color[0] * i) / 7),
      Math.floor((shadow[1] * (7 - i) + color[1] * i) / 7),
      Math.floor((shadow[2] * (7 - i) + color[2] * i) / 7),
    ]);
  }

  let x = padding;
  for (const ch of text) {
    const slot = font.slot(ch.codePointAt(0) ?? 32);
    const glyph = slot === -1 ? null : font.glyphs[slot];
    if (glyph) {
      for (let gy = 0; gy < glyph.height; gy++) {
        for (let gx = 0; gx < glyph.width; gx++) {
          const v = glyph.pixels[gy * glyph.stride + gx]! & 7;
          if (v === 0) continue;
          const px = x + gx;
          const py = padding + gy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const at = (py * width + px) * 4;
          const [r, g, b] = ramp[v]!;
          rgba[at] = r;
          rgba[at + 1] = g;
          rgba[at + 2] = b;
          rgba[at + 3] = 255;
        }
      }
    }
    x += font.advanceOf(slot);
  }

  return { width, height, rgba };
}

/**
 * Cut a label out of the screen it was composed over.
 *
 * The menu labels are not transparent sprites. Each one carries the photograph that was behind
 * it, so that blitting it at its own coordinates is invisible outside the letters — which is
 * exactly what made the original's hover work and exactly what makes them useless on a page as
 * they are. Comparing the label against the background it belongs to, pixel for pixel, leaves
 * the lettering and nothing else.
 *
 * `atX`/`atY` are the coordinates the original blits it at (source/menu.cc:1481-1489).
 */
export function labelPixels(
  label: QImage,
  over: QImage,
  atX: number,
  atY: number,
  /**
   * An optional second test on the colour. Difference alone is not quite enough for the menu
   * labels: the background has the *white* version of the same word painted into it, and the
   * sprite covers it with photograph, so those pixels differ too and come through as a ghost
   * of the word beside the word. Keeping only the label's own ink settles it.
   */
  keep?: (r: number, g: number, b: number) => boolean,
): Pixels {
  const { width, height } = label;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = label.indices[y * width + x]!;
      const behind = over.indices[(atY + y) * over.width + atX + x];
      if (index === 0 || index === behind) continue;
      const r = label.palette[index * 3]!;
      const g = label.palette[index * 3 + 1]!;
      const b = label.palette[index * 3 + 2]!;
      if (keep && !keep(r, g, b)) continue;
      const at = (y * width + x) * 4;
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/**
 * The menu lettering's ink: a yellow ramp from `#393100` up to `#ffff00`, with no blue in it.
 * Everything else in those sprites is the photograph they were composed over.
 */
export const isMenuInk = (r: number, g: number, b: number): boolean =>
  r + g > 60 && b * 10 < Math.min(r, g) * 6;

/** Cut a sprite out of the artwork, keying palette index 0 to transparent. */
export function spritePixels(img: QImage): Pixels {
  const { width, height, indices, palette } = img;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i]!;
    if (index === 0) continue;
    const at = i * 4;
    rgba[at] = palette[index * 3]!;
    rgba[at + 1] = palette[index * 3 + 1]!;
    rgba[at + 2] = palette[index * 3 + 2]!;
    rgba[at + 3] = 255;
  }
  return { width, height, rgba };
}

/** A region of an image, opaque — for taking the wordmark off the top of the menu artwork. */
export function cropPixels(img: QImage, sx: number, sy: number, w: number, h: number): Pixels {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = img.indices[(sy + y) * img.width + sx + x]!;
      const at = (y * w + x) * 4;
      rgba[at] = img.palette[index * 3]!;
      rgba[at + 1] = img.palette[index * 3 + 1]!;
      rgba[at + 2] = img.palette[index * 3 + 2]!;
      rgba[at + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
}

/* --- the DOM side -------------------------------------------------------- */

/** A canvas at 1:1. The page scales it with CSS, so one canvas serves every size. */
export function toCanvas(pixels: Pixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not get a 2d context');
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.rgba);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export const letteringCanvas = (
  text: string,
  font: Fontdata,
  opts?: LetteringOptions,
): HTMLCanvasElement => toCanvas(letteringPixels(text, font, opts));

export const labelCanvas = (
  label: QImage,
  over: QImage,
  atX: number,
  atY: number,
  keep?: (r: number, g: number, b: number) => boolean,
): HTMLCanvasElement => toCanvas(labelPixels(label, over, atX, atY, keep));
