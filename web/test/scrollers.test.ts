import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeQfnt } from '../src/render/font.js';
import { Framebuffer } from '../src/render/framebuffer.js';
import { BOARD_X, BOARD_Y, BOARD_H } from '../src/render/board-view.js';
import { TextScrollers, type NoticeSource } from '../src/render/scrollers.js';
import type { Notice } from '../src/engine/notices.js';

/** The real converted face, as the browser gets it. */
const font = (() => {
  const buf = readFileSync(new URL('../public/assets/font.qfnt', import.meta.url));
  return decodeQfnt(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
})();

/** A game, reduced to the two things a scroller reads off it. */
class Fake implements NoticeSource {
  ticks = 0;
  private queued: Notice[] = [];

  say(...notices: Notice[]): this {
    this.queued.push(...notices);
    return this;
  }

  drainNotices(): Notice[] {
    return this.queued.splice(0, this.queued.length);
  }
}

/** Advance a source by `ticks` and let the layer catch up with it, as a host frame would. */
function run(layer: TextScrollers, source: Fake, ticks: number): void {
  source.ticks += ticks;
  layer.follow(source);
}

/**
 * A layer already watching a fresh game, which is where a host starts. The first `follow` of
 * any source throws its backlog away — see the scrub test — so tests that want to see text
 * have to be past that.
 */
function watching(): { layer: TextScrollers; source: Fake } {
  const layer = new TextScrollers(font);
  const source = new Fake();
  layer.follow(source);
  return { layer, source };
}

describe('the text that rises up the well', () => {
  it('starts where Player_text_scroll puts it', () => {
    // `canvas->y + 330` for both, and give_line's xoffset of 20 against check_clean's
    // default of 4 (source/player.cc:598, source/canvas.cc:626).
    const { layer, source } = watching();
    source.say({ kind: 'clear', depth: 4, score: 2200 }, { kind: 'clean' });
    run(layer, source, 1);

    expect(layer.live).toEqual([
      { text: 'Quad! 2200 pts', x: BOARD_X + 20, y: BOARD_Y + 330 },
      { text: 'Clean Canvas!!', x: BOARD_X + 4, y: BOARD_Y + 330 },
    ]);
    // 30 px clear of the floor, and inside the well.
    expect(BOARD_Y + 330).toBe(BOARD_Y + BOARD_H - 30);
  });

  it('rises two pixels a tick and dies at the top of the well', () => {
    const { layer, source } = watching();
    source.say({ kind: 'clean' });
    run(layer, source, 0);

    // 330 px of travel at 2 px a tick: still there on the tick it reaches the top, as
    // `if(combo->y < canvas->y)` is checked after the move.
    run(layer, source, 164);
    expect(layer.live[0]?.y).toBe(BOARD_Y + 2);
    run(layer, source, 1);
    expect(layer.live[0]?.y).toBe(BOARD_Y);
    run(layer, source, 1);
    expect(layer.live).toEqual([]);
  });

  it('moves on the simulation clock, not the frame rate', () => {
    // One host frame worth ten ticks moves it exactly as far as ten frames worth one, so a
    // replay watched at half speed shows it rising at half speed.
    const { layer: fast, source: fastSource } = watching();
    fastSource.say({ kind: 'clean' });
    run(fast, fastSource, 0);
    run(fast, fastSource, 10);

    const { layer: slow, source: slowSource } = watching();
    slowSource.say({ kind: 'clean' });
    run(slow, slowSource, 0);
    for (let i = 0; i < 10; i++) run(slow, slowSource, 1);

    expect(fast.live).toEqual(slow.live);
    expect(fast.live[0]?.y).toBe(BOARD_Y + 330 - 20);
  });

  it('names each depth the way the string table does', () => {
    const said = (depth: number) => {
      const { layer, source } = watching();
      source.say({ kind: 'clear', depth, score: 100 });
      run(layer, source, 0);
      return layer.live[0]?.text;
    };
    expect(said(2)).toBe('Double! 100 pts');
    expect(said(3)).toBe('Triple! 100 pts');
    expect(said(4)).toBe('Quad! 100 pts');
    // ST_CLEARMORE takes the depth first and the score second.
    expect(said(6)).toBe('6-lines! 100 pts');
  });

  it('empties itself when the board it is over is replaced', () => {
    const { layer, source: first } = watching();
    first.say({ kind: 'clean' });
    run(layer, first, 4);
    expect(layer.live).toHaveLength(1);

    // A new game, or a replay seeked back — TapePlayer.seek rebuilds the game from scratch.
    run(layer, new Fake(), 0);
    expect(layer.live).toEqual([]);
  });

  it('throws away what a scrub simulated past instead of stacking it', () => {
    // Seeking re-simulates from frame zero, so the whole run's worth of notices arrives in
    // one go. None of it happened while anyone was watching, and showing it would pile a
    // dozen lines of text on the same spot.
    const layer = new TextScrollers(font);
    const scrubbed = new Fake();
    scrubbed.ticks = 90_000;
    scrubbed.say(
      { kind: 'clear', depth: 2, score: 500 },
      { kind: 'clean' },
      { kind: 'clear', depth: 4, score: 7700 },
    );
    layer.follow(scrubbed);
    expect(layer.live).toEqual([]);

    // And it picks up again from there, on the next thing that actually happens.
    scrubbed.say({ kind: 'clear', depth: 3, score: 1100 });
    run(layer, scrubbed, 1);
    expect(layer.live).toEqual([
      { text: 'Triple! 1100 pts', x: BOARD_X + 20, y: BOARD_Y + 330 },
    ]);
  });

  it('draws into the well and nowhere else', () => {
    const { layer, source } = watching();
    const fb = new Framebuffer();
    // A palette with a spread, so nearest-colour has something to pick between.
    const palette = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      palette[i * 3] = i;
      palette[i * 3 + 1] = i;
      palette[i * 3 + 2] = i;
    }
    fb.setPalette(palette);

    source.say({ kind: 'clean' });
    run(layer, source, 0);
    layer.draw(fb);

    let painted = 0;
    let strayed = 0;
    for (let y = 0; y < fb.height; y++) {
      for (let x = 0; x < fb.width; x++) {
        if (!fb.pixels[y * fb.width + x]) continue;
        painted++;
        const inside =
          x >= BOARD_X && x < BOARD_X + 180 && y >= BOARD_Y && y < BOARD_Y + BOARD_H;
        if (!inside) strayed++;
      }
    }
    expect(painted).toBeGreaterThan(0);
    expect(strayed).toBe(0);
  });
});
