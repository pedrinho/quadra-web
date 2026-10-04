import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeQfnt } from '../src/render/font.js';
import { letteringPixels } from '../src/render/lettering.js';

const asset = (name: string) => {
  const buf = readFileSync(new URL(`../public/assets/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const font = decodeQfnt(asset('font.qfnt'));

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
