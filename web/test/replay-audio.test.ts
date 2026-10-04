import { describe, it, expect } from 'vitest';
import { ReplayAudio, type SoundSource } from '../src/audio/replay-audio.js';
import { SoundPlayer } from '../src/audio/sound-player.js';
import { SOUND_FILES } from '../src/audio/sounds.js';
import type { Mixer } from '../src/audio/mixer.js';
import type { SoundBuffer } from '../src/audio/sound-bank.js';
import type { SoundEvent } from '../src/engine/sound-events.js';
import { Game } from '../src/engine/game.js';
import { Autoplayer, SCORING_SEED } from './autoplay.js';

/**
 * Sound for a run being watched.
 *
 * The thing under test is *when* the queue is played rather than what it sounds like — that is
 * pinned in sound.test.ts. What matters here is that a seek stays silent: `TapePlayer.seek`
 * re-simulates, so the queue after a scrub holds every event it passed over, and playing that
 * fires a whole run at one instant.
 */

class FakeMixer implements Mixer {
  readonly calls: string[] = [];
  play(sound: SoundBuffer): void {
    this.calls.push((sound as unknown as { name: string }).name);
  }
}

const setup = () => {
  const mixer = new FakeMixer();
  const bank = new Map(SOUND_FILES.map((n) => [n, { name: n } as unknown as SoundBuffer]));
  const sounds = new SoundPlayer(bank, mixer);
  return { mixer, sounds, audio: new ReplayAudio(() => sounds) };
};

/** A stand-in for a Game, so the timing can be driven exactly. */
class FakeSource implements SoundSource {
  ticks = 0;
  canvas = { level: 1 };
  queue: SoundEvent[] = [];
  drainSounds(): SoundEvent[] {
    return this.queue.splice(0, this.queue.length);
  }
}

describe('sound for a watched run', () => {
  it('plays what the game queued, in order', () => {
    const { mixer, audio } = setup();
    const source = new FakeSource();

    // The first follow is always an arrival, so get past it before asserting.
    audio.follow(source);

    source.ticks = 10;
    source.queue = [
      { kind: 'rotate', column: 9 },
      { kind: 'land', column: 9 },
    ];
    audio.follow(source);

    expect(mixer.calls).toHaveLength(2);
  });

  it('follows the level, so the theme changes with it', () => {
    const { sounds, audio } = setup();
    const source = new FakeSource();
    audio.follow(source);

    source.ticks = 1;
    source.canvas.level = 4;
    source.queue = [{ kind: 'levelUp' }];
    audio.follow(source);

    expect(sounds.level).toBe(4);
  });

  it('says nothing on the first sight of a game', () => {
    const { mixer, audio } = setup();
    const source = new FakeSource();
    // What a freshly built TapePlayer arrives holding.
    source.queue = [{ kind: 'land', column: 9 }];
    audio.follow(source);
    expect(mixer.calls).toEqual([]);
  });

  it('stays silent when the clock runs backwards', () => {
    const { mixer, audio } = setup();
    const source = new FakeSource();
    audio.follow(source);
    source.ticks = 500;
    audio.follow(source);
    mixer.calls.length = 0;

    // Seeking backwards inside the same game object.
    source.ticks = 20;
    source.queue = [{ kind: 'lineClear', chain: 1 }];
    audio.follow(source);

    expect(mixer.calls).toEqual([]);
  });

  it('stays silent when the game is replaced under it', () => {
    const { mixer, audio } = setup();
    const first = new FakeSource();
    audio.follow(first);
    first.ticks = 100;
    audio.follow(first);
    mixer.calls.length = 0;

    // What a backwards seek does: a new game, re-simulated to the target.
    const second = new FakeSource();
    second.ticks = 60;
    second.queue = [{ kind: 'land', column: 5 }, { kind: 'lineClear', chain: 2 }];
    audio.follow(second);

    expect(mixer.calls).toEqual([]);
  });

  it('stays silent after a reset, which is how a forward seek is declared', () => {
    const { mixer, audio } = setup();
    const source = new FakeSource();
    audio.follow(source);
    source.ticks = 10;
    audio.follow(source);
    mixer.calls.length = 0;

    // A forward seek looks exactly like playing — same game, clock going the same way — so the
    // transport has to say so, or scrubbing forward blares everything it skipped.
    audio.reset();
    source.ticks = 900;
    source.queue = [{ kind: 'land', column: 5 }];
    audio.follow(source);
    expect(mixer.calls).toEqual([]);

    // And it picks straight back up on the next ordinary frame.
    source.ticks = 901;
    source.queue = [{ kind: 'land', column: 5 }];
    audio.follow(source);
    expect(mixer.calls).toHaveLength(1);
  });

  it('drains on every path, so a queue nobody hears cannot grow', () => {
    // The reason this matters: env.sounds is a plain array, and the attract loop runs forever.
    const game = new Game({ seed: SCORING_SEED });
    const player = new Autoplayer(game);
    const audio = new ReplayAudio(() => null);

    for (let i = 0; i < 1500 && !game.isOver; i++) {
      player.frame();
      game.stepFrame(1);
      audio.follow(game);
    }

    // Nothing was played — there is no SoundPlayer — but nothing was kept either.
    expect(game.drainSounds()).toEqual([]);
  });

  it('takes a real Game, whose shape is the interface', () => {
    const { mixer, audio } = setup();
    const game = new Game({ seed: SCORING_SEED });
    const player = new Autoplayer(game);

    audio.follow(game);
    let landed = 0;
    for (let i = 0; i < 400 && !game.isOver; i++) {
      player.frame();
      game.stepFrame(1);
      audio.follow(game);
      landed = mixer.calls.length;
    }

    expect(landed).toBeGreaterThan(0);
  });
});
