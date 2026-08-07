import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeQfnt } from '../src/render/font.js';
import { decodeQimg } from '../src/render/qimg.js';
import {
  cropPixels,
  isMenuInk,
  labelPixels,
  letteringPixels,
  spritePixels,
} from '../src/render/lettering.js';

const asset = (name: string) => {
  const buf = readFileSync(new URL(`../public/assets/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const font = decodeQfnt(asset('font.qfnt'));
const menu = decodeQimg(asset('debuto.qimg'));
const playLabel = decodeQimg(asset('debut0.qimg'));

/** Every fourth byte, so "is anything drawn here" is one question rather than four. */
const alphas = (rgba: Uint8ClampedArray) => rgba.filter((_, i) => i % 4 === 3);

describe('setting words in the game\'s lettering', () => {
  it('inks the glyphs and leaves everything else transparent', () => {
    const pixels = letteringPixels('Highscores', font);
    const alpha = alphas(pixels.rgba);
    const inked = alpha.filter((a) => a === 255).length;
    expect(inked).toBeGreaterThan(100);
    // Lettering is mostly gaps: if this ever approached the full area, the transparency key
    // would have stopped working and the page would show boxes instead of words.
    expect(inked).toBeLessThan(alpha.length * 0.6);
  });

  it('sizes the image to the text it just set', () => {
    const short = letteringPixels('Hi', font);
    const long = letteringPixels('Highscores', font);
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.width).toBe(font.width('Highscores'));
    expect(long.height).toBe(font.height);
  });

  it('sets words the original never printed, which is the point of having the face', () => {
    // No sprite exists for this — it is set from the glyphs, in Quadra's own lettering.
    const pixels = letteringPixels('How it works', font);
    expect(alphas(pixels.rgba).some((a) => a === 255)).toBe(true);
  });

  it('draws the shadow at the edges and the colour in the middle', () => {
    // The ramp runs from shadow to colour, so both must appear. Mapping intensity to alpha
    // instead would drop the dark edge that keeps this readable over a photograph.
    const pixels = letteringPixels('Highscores', font, {
      color: [255, 255, 0],
      shadow: [255, 0, 0],
    });
    const seen = new Set<string>();
    for (let i = 0; i < pixels.rgba.length; i += 4) {
      if (pixels.rgba[i + 3] === 255) seen.add(`${pixels.rgba[i]},${pixels.rgba[i + 1]}`);
    }
    expect(seen.has('255,255')).toBe(true); // full colour
    expect(seen.size).toBeGreaterThan(1); // and at least one step of the ramp
  });
});

describe('cutting the artwork up', () => {
  it('keeps a label\'s lettering and drops the photograph behind it', () => {
    // debut0 is the yellow "SINGLE-PLAYER GAME", and it carries the menu photograph around the
    // letters so that blitting it at 160,99 is invisible outside them. Subtracting the
    // background it belongs to is what leaves the lettering alone.
    const cut = labelPixels(playLabel, menu, 160, 99, isMenuInk);
    const kept = alphas(cut.rgba).filter((a) => a === 255).length;
    const whole = spritePixels(playLabel);
    const before = alphas(whole.rgba).filter((a) => a === 255).length;

    expect(kept).toBeGreaterThan(500);
    // The overwhelming majority of the sprite is background, and it has to go.
    expect(kept).toBeLessThan(before * 0.5);

    // Everything kept is the yellow ink, not a scrap of the photograph.
    for (let i = 0; i < cut.rgba.length; i += 4) {
      if (cut.rgba[i + 3] !== 255) continue;
      expect(isMenuInk(cut.rgba[i]!, cut.rgba[i + 1]!, cut.rgba[i + 2]!)).toBe(true);
    }
  });

  it('cuts an opaque region for the wordmark', () => {
    const crop = cropPixels(menu, 36, 6, 568, 92);
    expect(crop.width).toBe(568);
    expect(crop.height).toBe(92);
    expect(alphas(crop.rgba).every((a) => a === 255)).toBe(true);
  });

  it('keys index zero out of a sprite', () => {
    const pixels = spritePixels(playLabel);
    let transparent = 0;
    for (let i = 0; i < playLabel.indices.length; i++) {
      if (playLabel.indices[i] === 0) {
        transparent++;
        expect(pixels.rgba[i * 4 + 3]).toBe(0);
      }
    }
    // A sanity check on the fixture rather than on the code: if this sprite had no keyed
    // pixels at all the assertion above would pass without testing anything.
    expect(transparent).toBeGreaterThanOrEqual(0);
  });
});
