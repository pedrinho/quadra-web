import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SoundPlayer, type RandomInt } from '../src/audio/sound-player.js';
import { SOUND_THEMES, themeForLevel, GLOBAL_SOUNDS, SOUND_FILES } from '../src/audio/sounds.js';
import { decodeQsnd, type RawSample, type SoundBuffer } from '../src/audio/sound-bank.js';
import { MAX_VOICES, VOLUME_FLOOR, HEADROOM } from '../src/audio/mixer.js';
import { encodeQsnd } from '../tools/codecs.js';
import type { Mixer } from '../src/audio/mixer.js';
import type { SoundEvent } from '../src/engine/sound-events.js';

interface Call {
  name: string;
  vol: number;
  pan: number;
  freq: number;
}

/** Records what was asked of the mixer, so the mapping can be asserted without Web Audio. */
class FakeMixer implements Mixer {
  readonly calls: Call[] = [];
  play(sound: SoundBuffer, vol: number, pan: number, freq: number): void {
    this.calls.push({ name: (sound as unknown as { name: string }).name, vol, pan, freq });
  }
}

/** Every sample in the bank, standing in for a decoded AudioBuffer. */
const fakeBank = (): Map<string, SoundBuffer> =>
  new Map(SOUND_FILES.map((n) => [n, { name: n } as unknown as SoundBuffer]));

/** `rnd(max)` always returning the same value, so the constants are pinned exactly. */
const fixed = (v: number): RandomInt => () => v;

const setup = (rnd: RandomInt = fixed(0), level = 1) => {
  const mixer = new FakeMixer();
  const player = new SoundPlayer(fakeBank(), mixer, rnd);
  player.level = level;
  return { mixer, player };
};

const play = (event: SoundEvent, rnd: RandomInt = fixed(0), level = 1): Call => {
  const { mixer, player } = setup(rnd, level);
  player.playOne(event);
  expect(mixer.calls).toHaveLength(1);
  return mixer.calls[0]!;
};

describe('sound event mapping', () => {
  it('pans a rotation by the piece column, as (bx - 9) * 300', () => {
    // source/player.cc:143-144. Column 9 is dead centre.
    expect(play({ kind: 'rotate', column: 9 }).pan).toBe(0);
    expect(play({ kind: 'rotate', column: 4 }).pan).toBe(-1500);
    expect(play({ kind: 'rotate', column: 13 }).pan).toBe(1200);
  });

  it('plays the theme drip on rotate with the original constants', () => {
    const call = play({ kind: 'rotate', column: 9 }, fixed(0));
    expect(call).toEqual({ name: 'tapdrip', vol: -200, pan: 0, freq: 10500 });
    // The jitter widens volume by up to 127 and pitch by up to 1023.
    const jittered = play({ kind: 'rotate', column: 9 }, fixed(127));
    expect(jittered.vol).toBe(-327);
    expect(play({ kind: 'rotate', column: 9 }, fixed(1023)).freq).toBe(11523);
  });

  it('picks all three landing variants', () => {
    // source/player.cc:1564-1571 — ugs_random.rnd()%3 over depose / depose2 / depose3.
    const theme = SOUND_THEMES[0]!;
    expect(play({ kind: 'land', column: 9 }, fixed(0)).name).toBe(theme.depose);
    expect(play({ kind: 'land', column: 9 }, fixed(1)).name).toBe(theme.depose2);
    expect(play({ kind: 'land', column: 9 }, fixed(2)).name).toBe(theme.depose3);
  });

  it('drops the line-clear pitch by exactly 256 per chain step', () => {
    // The cascade feedback — source/player.cc:762, `- (complexity << 8)`.
    const freqAt = (chain: number) => play({ kind: 'lineClear', chain }).freq;
    expect(freqAt(1)).toBe(11000 - 256);
    expect(freqAt(2)).toBe(11000 - 512);
    expect(freqAt(7)).toBe(11000 - 7 * 256);
    expect(freqAt(1) - freqAt(2)).toBe(256);
  });

  it('makes a longer cascade fall louder, clamping at full volume', () => {
    // source/player.cc:849-853 — vol = min(0, -500 + tombe*50).
    const volAt = (rowsFallen: number) =>
      play({ kind: 'cascadeSettled', chain: 1, rowsFallen }).vol;
    expect(volAt(1)).toBe(-450);
    expect(volAt(4)).toBe(-300);
    expect(volAt(10)).toBe(0);
    expect(volAt(30)).toBe(0); // clamped, never positive
  });

  it('uses the global clang for a settled cascade, not a theme sample', () => {
    const call = play({ kind: 'cascadeSettled', chain: 2, rowsFallen: 2 });
    expect(call.name).toBe(GLOBAL_SOUNDS.cascade);
    expect(call.freq).toBe(11000 - 512);
    expect(call.pan).toBe(-1);
  });

  it('plays the level-up glissando centred and unjittered in pitch', () => {
    expect(play({ kind: 'levelUp' })).toEqual({
      name: GLOBAL_SOUNDS.levelUp,
      vol: -200,
      pan: 0,
      freq: 11000,
    });
  });

  it('plays game over high and off-centre', () => {
    // source/player.cc:1282 — the port fires this once instead of per wipe frame.
    expect(play({ kind: 'gameOver' })).toEqual({
      name: SOUND_THEMES[0]!.flash,
      vol: -600,
      pan: -1,
      freq: 22500,
    });
  });

  it('plays a batch in order', () => {
    const { mixer, player } = setup();
    player.play([{ kind: 'levelUp' }, { kind: 'gameOver' }, { kind: 'rotate', column: 9 }]);
    expect(mixer.calls.map((c) => c.name)).toEqual(['glissup', 'pwap2', 'tapdrip']);
  });

  it('stays silent for a sample the bank does not have', () => {
    const mixer = new FakeMixer();
    new SoundPlayer(new Map(), mixer, fixed(0)).playOne({ kind: 'levelUp' });
    expect(mixer.calls).toHaveLength(0);
  });
});

describe('level themes', () => {
  it('cycles every ten levels, 1-based', () => {
    // source/canvas.cc:661 — num = (level-1) % 10.
    expect(themeForLevel(1)).toBe(SOUND_THEMES[0]);
    expect(themeForLevel(10)).toBe(SOUND_THEMES[9]);
    expect(themeForLevel(11)).toBe(SOUND_THEMES[0]);
    expect(themeForLevel(21)).toBe(SOUND_THEMES[0]);
    expect(themeForLevel(35)).toBe(SOUND_THEMES[4]);
  });

  it('changes which samples the same event produces', () => {
    expect(play({ kind: 'rotate', column: 9 }, fixed(0), 1).name).toBe('tapdrip');
    expect(play({ kind: 'rotate', column: 9 }, fixed(0), 3).name).toBe('click_1');
    expect(play({ kind: 'lineClear', chain: 1 }, fixed(0), 10).name).toBe('smash2');
  });

  it('names only samples that are actually shipped', () => {
    const shipped = new Set<string>(SOUND_FILES);
    for (const theme of SOUND_THEMES) {
      for (const name of Object.values(theme)) expect(shipped).toContain(name);
    }
    for (const name of Object.values(GLOBAL_SOUNDS)) expect(shipped).toContain(name);
  });
});

describe('mixer policy', () => {
  it('keeps the original 8-voice limit and headroom', () => {
    // source/sound.cc:30-35. These are the numbers the whole mix is balanced around.
    expect(MAX_VOICES).toBe(8);
    expect(VOLUME_FLOOR).toBe(-4096);
    expect(HEADROOM).toBe(0.25);
  });
});

describe('.qsnd bank', () => {
  it('round-trips names, rates and samples', () => {
    const entries = new Map([
      ['blip1', { rate: 11025, pcm: new Uint8Array([128, 200, 56, 128]) }],
      ['click_1', { rate: 22050, pcm: new Uint8Array([1, 2, 3]) }],
    ]);
    const decoded = decodeQsnd(toArrayBuffer(encodeQsnd(entries)));

    expect([...decoded.keys()]).toEqual(['blip1', 'click_1']);
    // The original rate is the whole point — the pitch ratio is taken against it.
    expect(decoded.get('blip1')!.rate).toBe(11025);
    expect(decoded.get('click_1')!.rate).toBe(22050);
    expect([...decoded.get('blip1')!.pcm]).toEqual([128, 200, 56, 128]);
  });

  it('rejects a file that is not a bank', () => {
    const bogus = Buffer.from('NOPEnothing');
    expect(() => decodeQsnd(toArrayBuffer(bogus))).toThrow(/not a \.qsnd/);
  });

  it('keeps each sample at its own rate through extraction', () => {
    const bank = shippedBank();
    expect(bank.get('blip1')!.rate).toBe(11025);
    expect(bank.get('blip1')!.pcm.length).toBeGreaterThan(0);
    // glissup is one of the eight 22050 Hz files, and is played at 11000 — an octave down.
    // If extraction ever normalised the rates, that octave would silently disappear.
    expect(bank.get('glissup')!.rate).toBe(22050);
  });

  it('ships every sample the game asks for', () => {
    const bank = shippedBank();
    for (const name of SOUND_FILES) {
      expect(bank.has(name), `${name} missing from sounds.qsnd`).toBe(true);
    }
  });
});

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * The bank as actually shipped. This is the only copy of the original audio in the
 * repository — the upstream `sons/` tree is not vendored — so these tests assert the
 * artifact users download rather than a source file that is not here.
 */
function shippedBank(): Map<string, RawSample> {
  const path = new URL('../public/assets/sounds.qsnd', import.meta.url).pathname;
  return decodeQsnd(toArrayBuffer(readFileSync(path)));
}
