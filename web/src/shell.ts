/*
 * The furniture both pages are built out of.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The site is a few documents — the stage at `/`, the board at `/records`, every run at
 * `/player-highscores` — and everything in here is what they have in common: the identity in the
 * masthead's corner, the audio context, the settings, and the level backdrops a replay needs in
 * order to be watched.
 *
 * Split out rather than shared by importing `main.ts`, because that entry hard-requires the
 * stage's twenty-odd element ids and throws on the first one it cannot find. What belongs here is
 * only what is true of any page; anything a single page needs stays in that page's entry.
 */

import { loadQimg, type QImage } from './render/qimg.js';
import { Api, type Account } from './api.js';
import { AccountPanel } from './ui/account-panel.js';
import { APP_VERSION } from './version.js';
import { createMixer, WebAudioMixer, type Mixer } from './audio/mixer.js';
import { loadSoundBank, type SoundBuffer } from './audio/sound-bank.js';
import { SoundPlayer } from './audio/sound-player.js';
import { DEFAULT_VOLUME, type Settings } from './settings.js';

/** Number of level backdrops. */
export const LEVELS = 10;

/** An element a page cannot do without. Throws, so a broken document fails loudly. */
export const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
};

/** An element only some pages carry. */
export const maybeEl = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

/** A cache of decoded artwork, so two callers asking for the same image fetch it once. */
export function createImages(): (name: string) => Promise<QImage> {
  const images = new Map<string, Promise<QImage>>();
  return (name: string) => {
    let pending = images.get(name);
    if (!pending) {
      pending = loadQimg(`assets/${name}.qimg`);
      images.set(name, pending);
    }
    return pending;
  };
}

/** The build's version, in the colophon of whichever page carries one. */
export function paintVersion(): void {
  const version = maybeEl('version');
  if (version) version.textContent = `port ${APP_VERSION}`;
}

export interface Audio {
  mixer: Mixer;
  /** The context, so a caller can ask whether it has been allowed to start. Null without one. */
  ctx: BaseAudioContext | null;
  /** Read lazily: the bank loads asynchronously, so a value taken now would be null for good. */
  sounds: () => SoundPlayer | null;
  ready: Promise<void>;
  /** Push the saved volume into the master gain. The only volume there is. */
  applyVolume(settings: Settings): void;
}

/**
 * Audio is optional: a browser without Web Audio, or a checkout where the bank has not been
 * generated, must still leave the game fully playable and the replays watchable.
 *
 * Browsers will not start an audio context without a gesture, so one is listened for here. Until
 * it arrives the mixer drops what it is asked to play rather than queueing it, which is also why
 * the attract loop is silent whatever anyone wires to it.
 */
export function createAudio(): Audio {
  const { mixer, ctx } = createMixer();
  let player: SoundPlayer | null = null;

  const ready = (async () => {
    let bank: ReadonlyMap<string, SoundBuffer> = new Map();
    if (ctx) {
      try {
        bank = await loadSoundBank('assets/sounds.qsnd', ctx);
      } catch (err) {
        console.warn('sound disabled:', err);
      }
    }
    player = new SoundPlayer(bank, mixer);
  })();

  const unlock = () => {
    if (mixer instanceof WebAudioMixer) void mixer.resume();
  };
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);

  return {
    mixer,
    ctx,
    sounds: () => player,
    ready,
    applyVolume(settings) {
      if (mixer instanceof WebAudioMixer) mixer.setVolume(settings.volume);
    },
  };
}

/**
 * The replay transport's sound control, over the one volume setting there is.
 *
 * A toggle rather than a second slider, and over the *saved* setting rather than a mute of its
 * own, so a replay silenced here is still silent in the next game and on the other page.
 */
export function createMuting(
  settings: Settings,
  apply: () => void,
): { isMuted: () => boolean; toggle: () => void } {
  // Where the slider was, so unmuting returns there rather than to a default. Seeded from the
  // setting so a page loaded at zero still unmutes to something audible.
  let before = settings.volume || DEFAULT_VOLUME;
  return {
    isMuted: () => settings.volume === 0,
    toggle: () => {
      if (settings.volume === 0) {
        settings.volume = before;
      } else {
        before = settings.volume;
        settings.volume = 0;
      }
      apply();
    },
  };
}

/**
 * The ten level backdrops are 307 KB each — raw palette indices, one byte a pixel — and waiting
 * for all of them puts 3 MB in front of the first piece. Only the first level's is needed to
 * start, so that is the only one anything waits for; the rest arrive while the game is being
 * played or the replay watched, and `Screen.background` already falls back to the first while one
 * is still in flight.
 *
 * The fallback is silent, though, and `Screen` caches the level it last drew — so a backdrop that
 * lands after its level has begun needs someone to ask for a repaint. `onLate` is that someone.
 */
export function loadBackgrounds(
  image: (name: string) => Promise<QImage>,
  onLate: (level: number) => void,
): { backgrounds: (QImage | undefined)[]; ready: Promise<void> } {
  const backgrounds: (QImage | undefined)[] = new Array<QImage | undefined>(LEVELS);
  const ready = image('fond0').then((img) => {
    backgrounds[0] = img;
  });
  for (let i = 1; i < LEVELS; i++) {
    void image(`fond${i}`).then((img) => {
      backgrounds[i] = img;
      onLate(i + 1);
    });
  }
  return { backgrounds, ready };
}

export interface Identity {
  account: AccountPanel;
  paint(who: Account | null): void;
}

/** The Sign in button and the panel behind it, in the masthead of both pages. */
export function createIdentity(opts: {
  api: Api;
  onAccount: (who: Account | null) => void;
  onVisibility?: (open: boolean) => void;
}): Identity {
  const button = el<HTMLButtonElement>('account');

  const paint = (who: Account | null): void => {
    button.textContent = who ? who.displayName : 'Sign in';
    button.dataset['state'] = who ? (who.verified ? 'verified' : 'unverified') : 'out';
    document.body.classList.toggle('is-signed-in', who !== null);
  };

  const account = new AccountPanel({
    host: document.body,
    api: opts.api,
    onAccount: (who) => {
      paint(who);
      opts.onAccount(who);
    },
    ...(opts.onVisibility ? { onVisibility: opts.onVisibility } : {}),
  });

  button.addEventListener('click', () => account.show());
  return { account, paint };
}

/**
 * The links that land a player on a page mid-way through signing in: the two that arrive by mail,
 * and Google's way back — `?welcome=` for a first sign-in that still needs a name, and
 * `?signin=failed` for one that did not complete. All of them are a query parameter rather than a
 * route of their own, so there is no route to add and the page is already loading behind the
 * panel. The parameter is stripped once read: the tokens are single-use, and leaving one in the
 * address bar would put it in history and in whatever gets shared from there.
 */
export function readSignInLink(account: AccountPanel): void {
  if (takeParam('signin') === 'failed') {
    account.signInFailed();
    return;
  }
  for (const kind of ['verify', 'reset', 'welcome'] as const) {
    const token = takeParam(kind);
    if (!token) continue;
    account.openFromLink(kind, token);
    return;
  }
}

/** Read a query parameter and take it back out of the address bar, as the mail links do. */
export function takeParam(name: string): string | null {
  const params = new URLSearchParams(location.search);
  const value = params.get(name);
  if (value === null) return null;
  params.delete(name);
  history.replaceState(null, '', location.pathname + stripped(params));
  return value;
}

function stripped(params: URLSearchParams): string {
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
