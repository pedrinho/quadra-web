/*
 * The game's own lettering, for the words it says on the board.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * `letteringPixels` sets text in Quadra's own 1998 bitmap face, from indexed glyphs to RGBA with
 * a real alpha channel. The glyphs store intensities 0-7 rather than colours (see render/font.ts),
 * so any word can be set in it — which is how pause and game over are said over the board in the
 * game's voice rather than the page's.
 *
 * This module used to cut the menu labels and the wordmark out of the artwork for the page around
 * the board too. The page no longer borrows the artwork, so only the lettering is left.
 *
 * The conversion is pure so it can be tested without a browser; `toCanvas` and `letteringCanvas`
 * are the thin DOM wrappers the page actually calls.
 */

import type { Fontdata, Rgb } from './font.js';

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

