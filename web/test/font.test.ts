import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Framebuffer } from '../src/render/framebuffer.js';
import { Font, decodeQfnt, findRgb } from '../src/render/font.js';

/** The real converted face, as the browser gets it. */
const load = (name: string) => {
  const buf = readFileSync(new URL(`../public/assets/${name}.qfnt`, import.meta.url));
  return decodeQfnt(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

const normal = load('font');
const courrier = load('courrier');

/** A palette with a usable spread, so nearest-colour has something to choose between. */
const palette = (() => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = 255 - i;
    p[i * 3 + 2] = (i * 7) & 0xff;
  }
  return p;
})();

describe('the original lettering', () => {
  it('has a glyph for every printable character', () => {
    for (const ch of 'ABCXYZabcxyz0189!?.,:-') {
      const slot = normal.slot(ch.charCodeAt(0));
      expect(slot, ch).toBeGreaterThanOrEqual(0);
      expect(normal.glyphs[slot], ch).not.toBeNull();
    }
    expect(normal.height).toBeGreaterThan(10);
  });

  it('advances a space by the width of an i, as the original does', () => {
    // Space has no glyph at all; `Fontdata::width` falls back to 'i' for it and for anything
    // else it cannot draw, so two words are separated by an i-width gap and not by nothing.
    const gap = normal.width('a a') - normal.width('aa');
    expect(gap).toBe(normal.width('i') - normal.shrink);
    expect(gap).toBeGreaterThan(0);
  });

  it('measures a string as the sum of what it will draw', () => {
    const fb = new Framebuffer(320, 40);
    const font = new Font(normal, palette, [255, 255, 255]);
    const end = font.draw(fb, 'Score', 10, 10);
    // width() includes the trailing overlap the last glyph does not consume.
    expect(end - 10).toBe(font.width('Score') - normal.shrink);
  });

  it('keeps the monospaced face monospaced, so a column of numbers lines up', () => {
    expect(courrier.width('0000')).toBe(courrier.width('1111'));
    expect(courrier.width('1234567890')).toBe(courrier.width('0000000000'));
  });
});

describe('colouring', () => {
  it('picks the nearest palette entry and never index zero', () => {
    const p = new Uint8Array(768);
    // 0 is the transparency key and is deliberately the closest match to what we ask for.
    p.set([10, 10, 10], 0);
    p.set([200, 0, 0], 3);
    p.set([0, 200, 0], 6);
    expect(findRgb(p, 10, 10, 10)).not.toBe(0);
    expect(findRgb(p, 190, 10, 10)).toBe(1);
    expect(findRgb(p, 10, 190, 10)).toBe(2);
  });

  it('draws the same glyphs in two colours without touching the glyphs', () => {
    const white = new Font(normal, palette, [255, 255, 255], [0, 20, 40]);
    const yellow = new Font(normal, palette, [255, 255, 0], [0, 20, 40]);

    const render = (font: Font) => {
      const fb = new Framebuffer(200, 30);
      fb.clear(0);
      font.draw(fb, 'Hero', 5, 5);
      return fb.pixels;
    };
    const a = render(white);
    const b = render(yellow);
    // The same pixels are inked...
    const inkedA = [...a].map((v) => (v === 0 ? 0 : 1));
    const inkedB = [...b].map((v) => (v === 0 ? 0 : 1));
    expect(inkedA).toEqual(inkedB);
    expect(inkedA.some((v) => v === 1)).toBe(true);
    // ...in different colours.
    expect([...a]).not.toEqual([...b]);
  });

  it('leaves the background showing through a glyph, rather than boxing it', () => {
    // Intensity 0 is transparent: text over the menu photograph has to sit *in* it.
    const fb = new Framebuffer(120, 30);
    fb.clear(77);
    new Font(normal, palette, [255, 255, 255]).draw(fb, 'l', 4, 4);
    expect([...fb.pixels].some((v) => v === 77)).toBe(true);
    expect([...fb.pixels].some((v) => v !== 77)).toBe(true);
  });

  it('clips at the edge of what it is drawing into', () => {
    const fb = new Framebuffer(40, 20);
    const font = new Font(normal, palette, [255, 255, 255]);
    expect(() => font.draw(fb, 'Highscores', -12, 14)).not.toThrow();
    expect(() => font.drawRight(fb, '999999', 4, 2)).not.toThrow();
  });
});
