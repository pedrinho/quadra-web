/*
 * Browser entry point: the page, its assets, and the game when someone presses play.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The page is a page. It is not the 1998 application redrawn inside a canvas — the artwork,
 * the lettering and the palette are the materials it is built from, and the only thing the
 * framebuffer draws is the playfield itself, which is the one part that has to be pixel-exact.
 */

import './styles.css';

import { Game } from './engine/game.js';
import { loadQimg, type QImage } from './render/qimg.js';
import { loadQfnt } from './render/font.js';
import { Screen, PLAYFIELD_VIEW } from './render/screen.js';
import { cropPixels, isMenuInk, labelCanvas, toCanvas } from './render/lettering.js';
import { Keyboard } from './input/keyboard.js';
import { loadSettings, saveSettings } from './settings.js';
import { SettingsPanel, bindingsHelp } from './ui/settings-panel.js';
import { ReplayViewer } from './ui/replay-viewer.js';
import { Records } from './ui/records.js';
import { Hero } from './ui/hero.js';
import { GameView } from './ui/game-view.js';
import { AccountPanel } from './ui/account-panel.js';
import { Api, apiMessage, isUnreachable, type Account, type BoardRun } from './api.js';
import { decodeTape } from './replay/tape.js';
import { record, type TapeRecorder } from './replay/recorder.js';
import { APP_VERSION } from './version.js';
import { createMixer, WebAudioMixer } from './audio/mixer.js';
import { loadSoundBank, type SoundBuffer } from './audio/sound-bank.js';
import { SoundPlayer } from './audio/sound-player.js';

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
};

const LEVELS = 10;
/* Coordinates in the menu artwork. The logo crop is measured off `debuto.qimg`; the label
 * positions are the ones the original blits them at (source/menu.cc:1481-1519), which is what
 * makes it possible to subtract the background from behind the lettering. */
const WORDMARK = { x: 36, y: 6, width: 568, height: 92 };
const PLAY_LABEL = { x: 160, y: 99 };
/* The fourth item down the menu. The page has a section by the same name, so it uses the
 * original's own word for it (source/menu.cc:1484). */
const HIGHSCORES_LABEL = { x: 235, y: 225 };
const SIGNATURE = { x: 0, y: 390 };

async function main(): Promise<void> {
  const boardEl = el<HTMLCanvasElement>('screen');
  boardEl.width = PLAYFIELD_VIEW.width;
  boardEl.height = PLAYFIELD_VIEW.height;
  const ctx = boardEl.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('could not get a 2d context');
  ctx.imageSmoothingEnabled = false;

  const images = new Map<string, Promise<QImage>>();
  const image = (name: string): Promise<QImage> => {
    let pending = images.get(name);
    if (!pending) {
      pending = loadQimg(`assets/${name}.qimg`);
      images.set(name, pending);
    }
    return pending;
  };

  el('version').textContent = `port ${APP_VERSION}`;

  /* Type first. The page is already painted by the time this runs; what these add is the
   * lettering, which is the one thing that cannot be done with a web font. */
  const font = await loadQfnt('assets/font.qfnt');

  void Promise.all([
    image('debuto'),
    image('debut0'),
    image('debut3'),
    image('debut8'),
  ]).then(([menu, play, highscores, mark]) => {
    const wordmark = toCanvas(
      cropPixels(menu, WORDMARK.x, WORDMARK.y, WORDMARK.width, WORDMARK.height),
    );
    // Airbrushed, not pixel art: let the browser scale it smoothly.
    wordmark.style.imageRendering = 'auto';
    document.querySelector('[data-crop="wordmark"]')?.prepend(wordmark);

    // One canvas each: cloning a canvas element copies its size and not a pixel of its bitmap.
    for (const button of document.querySelectorAll('button.play')) {
      const label = labelCanvas(play, menu, PLAY_LABEL.x, PLAY_LABEL.y, isMenuInk);
      label.className = 'sprite-art';
      button.prepend(label);
    }

    const heading = labelCanvas(
      highscores,
      menu,
      HIGHSCORES_LABEL.x,
      HIGHSCORES_LABEL.y,
      isMenuInk,
    );
    heading.className = 'sprite-art';
    document.querySelector('[data-sprite="highscores"]')?.prepend(heading);

    const signature = labelCanvas(mark, menu, SIGNATURE.x, SIGNATURE.y);
    signature.className = 'sprite-art';
    document.querySelector('[data-sprite="signature"]')?.prepend(signature);
  });
  void image('multi').then((art) => paintGround(el<HTMLCanvasElement>('ground'), art));
  /* Its two headings are painted in at y 15-30 and y 225-240; everything below is fireworks. */
  void image('hscore').then((art) =>
    paintGround(el<HTMLCanvasElement>('records-ground'), art, {
      x: 0,
      y: 270,
      width: 640,
      height: 210,
    }),
  );

  /*
   * The ten level backdrops are 307 KB each — raw palette indices, one byte a pixel — and waiting
   * for all of them put 3 MB in front of the first piece. Only the first level's is needed to
   * start, so that is the only one anything waits for; the rest arrive while the game is being
   * played, and `Screen.background` already falls back to the first while one is still in flight.
   *
   * The fallback is silent, though, and `Screen` caches the level it last drew — so a backdrop
   * that lands after its level has begun needs someone to ask for a repaint, or the player
   * finishes level 4 looking at level 1.
   */
  const backgrounds: (QImage | undefined)[] = new Array<QImage | undefined>(LEVELS);
  const backgroundsReady = image('fond0').then((img) => {
    backgrounds[0] = img;
  });
  for (let i = 1; i < LEVELS; i++) {
    void image(`fond${i}`).then((img) => {
      backgrounds[i] = img;
      if (game && game.canvas.level - 1 === i) screen.invalidate();
    });
  }
  let pauseBadge: QImage | null = null;
  void image('gamepaus').then((img) => (pauseBadge = img));

  // Audio is optional: a browser without Web Audio, or a checkout where the bank has not been
  // generated, must still leave the game fully playable.
  const { mixer, ctx: audioCtx } = createMixer();
  let sounds: SoundPlayer | null = null;
  const soundsReady = (async () => {
    let bank: ReadonlyMap<string, SoundBuffer> = new Map();
    if (audioCtx) {
      try {
        bank = await loadSoundBank('assets/sounds.qsnd', audioCtx);
      } catch (err) {
        console.warn('sound disabled:', err);
      }
    }
    sounds = new SoundPlayer(bank, mixer);
  })();

  const screen = new Screen(ctx, backgrounds, font);
  const settings = loadSettings();
  const keyboard = new Keyboard(settings.keys);
  const api = new Api();

  const view = new GameView(
    {
      attract: el('attract'),
      hud: el('hud'),
      state: el('board-state'),
      score: el('score'),
      lines: el('lines'),
      level: el('level'),
      chain: el('chain'),
    },
    font,
  );

  const hero = new Hero(screen, {
    section: el('stage'),
    eyebrow: el('attract-eyebrow'),
    score: el('attract-score'),
    facts: el('attract-facts'),
    lede: el('attract-lede'),
  });

  let playing = false;
  let game: Game | null = null;
  let recorder: TapeRecorder | null = null;
  let submitted = false;
  let last = performance.now();
  /*
   * The grant the current run is being played under, or null for a run that will not count.
   *
   * A ranked run is played on a seed the server issued and bound to one game, because a player
   * who picks their own seed can restart until the pieces fall kindly and submit only the game
   * that went well. Everything else — signed out, unconfirmed, or the service simply not
   * answering — still plays. It just does not count, and the page says so rather than refusing.
   */
  let grant: string | null = null;

  /* --- overlays ------------------------------------------------------------ */

  let overlays = 0;
  let pausedBeforeOverlay = false;
  const onOverlay = (open: boolean) => {
    if (open) {
      if (overlays === 0) {
        pausedBeforeOverlay = game?.paused ?? false;
        if (game) game.paused = true;
        keyboard.suspend();
      }
      overlays++;
    } else {
      overlays = Math.max(0, overlays - 1);
      if (overlays === 0 && game && playing) {
        game.paused = pausedBeforeOverlay;
        keyboard.resume();
      }
    }
  };

  const panel = new SettingsPanel({
    host: document.body,
    settings,
    onChange: applySettings,
    onVisibility: onOverlay,
  });

  const account = new AccountPanel({
    host: document.body,
    api,
    onAccount: (who) => {
      paintAccount(who);
      void records.refresh();
      // "The record to beat" is somebody's now, so who is looking changes what is highlighted.
      if (!playing) void startAttract();
    },
    onVisibility: onOverlay,
  });

  const accountButton = el<HTMLButtonElement>('account');
  accountButton.addEventListener('click', () => account.show());

  function paintAccount(who: Account | null): void {
    accountButton.textContent = who ? who.displayName : 'Sign in';
    accountButton.dataset['state'] = who ? (who.verified ? 'verified' : 'unverified') : 'out';
    document.body.classList.toggle('is-signed-in', who !== null);
  }

  const viewer = new ReplayViewer({
    host: document.body,
    screen,
    onVisibility: (open) => {
      document.body.classList.toggle('is-watching', open);
      onOverlay(open);
      if (open) hero.stop();
      else if (!playing) {
        hero.paint();
        hero.start();
      } else {
        screen.invalidate();
      }
    },
  });

  const watch = (bytes: Uint8Array | null, label: string) => {
    if (!bytes) return;
    try {
      viewer.show(decodeTape(bytes), label);
    } catch (err) {
      // A stored recording that no longer decodes is a bug or a hand-edited blob, not a reason
      // to take the page down.
      console.warn('could not open that replay:', err);
    }
  };

  const records = new Records({
    list: el('records-list'),
    empty: el('records-empty'),
    api,
    onWatch: (run: BoardRun) => {
      void api.tape(run.id).then((res) => {
        if (res.ok) watch(res.bytes, `${run.player} · ${run.score.toLocaleString()}`);
      });
    },
  });
  void records.refresh();

  function applySettings(): void {
    saveSettings(settings);
    game?.setSensitivity(settings.hSensitivity, settings.vSensitivity, settings.continuous);
    // Order matters: Keyboard pushes the bindings into the canvas, so its grouping wins.
    keyboard.setBindings(settings.keys);
    if (mixer instanceof WebAudioMixer) mixer.setVolume(settings.volume);
    el('keys').textContent = bindingsHelp(settings);
  }
  applySettings();

  /* --- the attract replay -------------------------------------------------- */

  const demoTape = (async () => {
    const res = await fetch('assets/demo.qtape');
    if (!res.ok) throw new Error(`no demo recording: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, tape: decodeTape(bytes) };
  })();

  /*
   * The stage plays the best run on the board, or the recording shipped with the build when the
   * board is empty or out of reach. Either way it is the engine replaying a tape, which is the
   * page's argument as much as its decoration.
   */
  const showBestRun = async () => {
    const board = await api.leaderboard('all', 1);
    const best = board.ok ? board.runs[0] : undefined;
    if (best) {
      const tape = await api.tape(best.id);
      if (tape.ok) {
        try {
          hero.show({
            bytes: tape.bytes,
            tape: decodeTape(tape.bytes),
            bundled: false,
            by: best.player,
          });
          return;
        } catch {
          /* a row whose recording will not decode is not worth taking the page down for */
        }
      }
    }
    const demo = await demoTape;
    hero.show({ ...demo, bundled: true });
  };

  /*
   * Both mailed links land on the page as a query parameter rather than on a route of their own,
   * so there is still exactly one document and the game is already loading behind the panel. The
   * parameter is stripped once read: a confirmation link is single-use, and leaving it in the
   * address bar would put it in history and in whatever gets shared from there.
   */
  const readMailLink = () => {
    const params = new URLSearchParams(location.search);
    for (const kind of ['verify', 'reset'] as const) {
      const token = params.get(kind);
      if (!token) continue;
      params.delete(kind);
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
      account.openFromLink(kind, token);
      return;
    }
  };

  void api.refresh().then((who) => {
    paintAccount(who);
    readMailLink();
  });

  const startAttract = async () => {
    await backgroundsReady;
    await showBestRun();
    if (!playing && !matchMedia('(prefers-reduced-motion: reduce)').matches) hero.start();
  };
  void startAttract();

  el('attract-watch').addEventListener('click', () => {
    const source = hero.current;
    if (source) watch(source.bytes, source.bundled ? 'the demonstration' : 'the record to beat');
  });

  /* --- playing ------------------------------------------------------------- */

  const startGame = async () => {
    await backgroundsReady;
    await soundsReady;
    hero.stop();

    // Ask for a seed if this run can count. If it cannot — signed out, unconfirmed, or the
    // service is not answering — fall back to a local seed and play anyway. A game that will
    // not start because a leaderboard is down is a worse game.
    grant = null;
    let seed: number | bigint = Date.now() & 0x7fffffff;
    if (api.account?.verified) {
      const issued = await api.startRun();
      if (issued.ok) {
        grant = issued.grant;
        seed = BigInt(issued.seed);
      } else if (!isUnreachable(issued)) {
        console.warn('playing unranked:', apiMessage(issued));
      }
    }

    const fresh = new Game({
      seed,
      level: 1,
      levelUp: true,
      shadow: true,
      hSensitivity: settings.hSensitivity,
      vSensitivity: settings.vSensitivity,
      continuous: settings.continuous,
      keys: settings.keys,
    });
    game = fresh;
    // Recording is on for every game and costs a few kilobytes a minute. A score is only worth
    // something if the run behind it can be re-simulated, so the recording *is* the run — there
    // is no "start recording" to forget. The bypass guard is a development aid: in production a
    // stray direct write should cost an unverifiable score, not a crash.
    recorder = record(fresh, { guard: import.meta.env.DEV });
    keyboard.dispose();
    keyboard.attach(window, fresh.inputSink);
    keyboard.resume();
    submitted = false;
    playing = true;
    view.show(true);
    screen.invalidate();
    // Discard anything queued during construction.
    fresh.drainSounds();
    fresh.drainNotices();
    sounds?.playStart();
    el('stage').scrollIntoView({ block: 'nearest' });
  };

  const leaveGame = () => {
    playing = false;
    game = null;
    keyboard.dispose();
    view.show(false);
    screen.invalidate();
    void startAttract();
  };

  /**
   * Offer the finished run to the board.
   *
   * The score is not submitted — the recording is, and the server verifies it and derives the
   * score itself. What comes back is the only number worth showing, because it is the only one
   * nobody here could have chosen.
   */
  const submitRun = async () => {
    submitted = true;
    if (!recorder) return;
    const score = game?.canvas.score ?? 0;

    if (!grant) {
      // A guest played a real game and it is over. Nothing was sent, and nothing was kept —
      // there is no local board any more, so this is the only place the score is ever shown.
      let why = 'sign in to rank your runs';
      if (api.account) {
        why = api.account.verified
          ? 'the board was out of reach when this run started'
          : 'confirm your e-mail address and your runs will count';
      }
      view.setState(score.toLocaleString(), `not recorded — ${why} · press R to play again`);
      return;
    }

    view.setState(score.toLocaleString(), 'verifying…');
    const result = await api.submitRun(grant, recorder.bytes());
    grant = null;

    if (result.ok) {
      view.setState(
        result.run.score.toLocaleString(),
        `verified · number ${result.rank} on the board · press R to play again`,
      );
      void records.refresh(result.run.id);
      return;
    }

    const because =
      result.code === 'no-score'
        ? 'no lines cleared, so nothing to record'
        : result.code === 'duplicate'
          ? 'already on the board'
          : isUnreachable(result)
            ? 'the board could not be reached'
            : `the board would not take it (${result.code})`;
    view.setState(score.toLocaleString(), `${because} · press R to play again`);
    if (result.code === 'unverifiable') console.warn('run did not verify:', result.message);
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const delta = Math.min(now - last, 250);
    last = now;
    if (!playing || !game || viewer.isOpen) return;

    if (!game.isOver) game.advance(delta);
    else if (!submitted) void submitRun();

    if (sounds) {
      // The level picks the sample theme, as Canvas::change_level does in the original.
      sounds.level = game.canvas.level;
      sounds.play(game.drainSounds());
    }

    screen.scrollers?.follow(game);
    screen.draw(game.canvas);
    if (game.paused && pauseBadge) screen.drawPaused(pauseBadge);
    view.update(game);
  };
  requestAnimationFrame(frame);

  /* --- input --------------------------------------------------------------- */

  for (const trigger of document.querySelectorAll('[data-play]')) {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      void startGame();
    });
  }
  el('hud-restart').addEventListener('click', () => void startGame());
  el('hud-settings').addEventListener('click', () => panel.show());
  el('hud-leave').addEventListener('click', leaveGame);

  window.addEventListener('keydown', (e) => {
    if (mixer instanceof WebAudioMixer) void mixer.resume();
    if (viewer.isOpen || account.isOpen) return;
    if (panel.isOpen) {
      if (e.code === 'Escape') {
        e.preventDefault();
        panel.hide();
      }
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      panel.show();
      return;
    }
    if (!playing || !game) return;
    // A key the player bound to a game action wins over these.
    if (keyboard.isBound(e.code)) return;
    if (e.code === 'KeyR') void startGame();
    else if (e.code === 'KeyW' && game.isOver) watch(recorder?.bytes() ?? null, 'your last run');
    else if (e.code === 'KeyP') {
      game.paused = !game.paused;
      if (game.paused) view.setState('Paused', 'press P to carry on');
      else view.clearState();
      sounds?.playPause();
    }
  });

  window.addEventListener('pointerdown', () => {
    if (mixer instanceof WebAudioMixer) void mixer.resume();
  });

  /* Dev hook: requestAnimationFrame is throttled to a stop in a background tab, so automated
   * checks cannot drive the game through the normal loop. */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__quadra = {
      get game() {
        return game;
      },
      get recorder() {
        return recorder;
      },
      get playing() {
        return playing;
      },
      hero,
      records,
      start: () => startGame(),
      leave: leaveGame,
      step(frames = 1) {
        if (!game) return null;
        for (let i = 0; i < frames; i++) game.stepFrame(1);
        if (game.isOver && !submitted) submitRun();
        sounds?.play(game.drainSounds());
        screen.scrollers?.follow(game);
        screen.draw(game.canvas);
        view.update(game);
        return {
          score: game.canvas.score,
          lines: game.canvas.linesTot,
          frame: game.frame,
          over: game.isOver,
        };
      },
      press: (action: number) => game?.input(action, true),
      release: (action: number) => game?.input(action, false),
    };
  }
}

/**
 * A photograph from the game, laid in behind a section as texture.
 *
 * `rect` takes a part of it. The highscore screen has its own headings painted into the
 * photograph, and a ground that says "Local highscores" behind a heading that already says
 * Highscores reads as a mistake — so that section takes the fireworks below the lettering.
 */
function paintGround(
  canvas: HTMLCanvasElement,
  art: QImage,
  rect = { x: 0, y: 0, width: art.width, height: art.height },
): void {
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pixels = cropPixels(art, rect.x, rect.y, rect.width, rect.height);
  const image = ctx.createImageData(rect.width, rect.height);
  image.data.set(pixels.rgba);
  ctx.putImageData(image, 0, 0);
}

main().catch((err: unknown) => {
  console.error(err);
  const lede = document.getElementById('attract-lede');
  if (lede) lede.textContent = `Something failed to load: ${String(err)}`;
});
