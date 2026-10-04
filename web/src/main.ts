/*
 * Browser entry point: the page, its assets, and the game when someone presses play.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The page is a page. It is not the 1998 application redrawn inside a canvas, and it is not
 * built out of that application's artwork either: the 1998 art lives on the board, where it was
 * made to be seen whole, and the framebuffer draws the playfield and nothing else.
 */

import './styles.css';

import { Game } from './engine/game.js';
import type { QImage } from './render/qimg.js';
import { loadQfnt } from './render/font.js';
import { Screen, PLAYFIELD_VIEW } from './render/screen.js';
import { Keyboard } from './input/keyboard.js';
import { loadSettings, saveSettings } from './settings.js';
import { SettingsPanel, renderBindings } from './ui/settings-panel.js';
import { ReplayViewer } from './ui/replay-viewer.js';
import { Hero } from './ui/hero.js';
import { GameView } from './ui/game-view.js';
import { Api, apiMessage, isUnreachable } from './api.js';
import { decodeTape } from './replay/tape.js';
import { record, type TapeRecorder } from './replay/recorder.js';
import {
  createAudio,
  createIdentity,
  createImages,
  createMuting,
  el,
  loadBackgrounds,
  paintVersion,
  readSignInLink,
} from './shell.js';

/** The last line under every finished run. */
const AGAIN = 'Press R to play again.';

async function main(): Promise<void> {
  const boardEl = el<HTMLCanvasElement>('screen');
  boardEl.width = PLAYFIELD_VIEW.width;
  boardEl.height = PLAYFIELD_VIEW.height;
  const ctx = boardEl.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('could not get a 2d context');
  ctx.imageSmoothingEnabled = false;

  const image = createImages();

  /* The game's own bitmap face, for the words it says on the board itself — paused, game over.
   * Everything around the board is the page's, and set in the page's face. */
  const font = await loadQfnt('assets/font.qfnt');

  paintVersion();

  const { backgrounds, ready: backgroundsReady } = loadBackgrounds(image, (level) => {
    if (game && game.canvas.level === level) screen.invalidate();
  });
  let pauseBadge: QImage | null = null;
  void image('gamepaus').then((img) => (pauseBadge = img));

  const audio = createAudio();
  const { sounds } = audio;

  const screen = new Screen(ctx, backgrounds, font);
  const settings = loadSettings();
  const keyboard = new Keyboard(settings.keys);
  const api = new Api();

  const view = new GameView(
    {
      attract: el('attract'),
      caption: el('attract-caption'),
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
    title: el('attract-title'),
    score: el('attract-score'),
    by: el('attract-by'),
    facts: el('attract-facts'),
    watch: el('attract-watch'),
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

  const identity = createIdentity({
    api,
    onAccount: () => {
      // "The record to beat" is somebody's now, so who is looking changes what is highlighted.
      if (!playing) void startAttract();
    },
    onVisibility: onOverlay,
  });

  const viewer = new ReplayViewer({
    host: document.body,
    screen,
    sounds,
    muting: createMuting(settings, applySettings),
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

  function applySettings(): void {
    saveSettings(settings);
    game?.setSensitivity(settings.hSensitivity, settings.vSensitivity, settings.continuous);
    // Order matters: Keyboard pushes the bindings into the canvas, so its grouping wins.
    keyboard.setBindings(settings.keys);
    audio.applyVolume(settings);
    renderBindings(el('keys'), settings);
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

  void api.refresh().then((who) => {
    identity.paint(who);
    readSignInLink(identity.account);
  });

  /*
   * `?tape=<path>` opens a recording straight in the viewer, with the scrubber and the speed
   * control the leaderboard rows get. Until this existed the only watchable tape was one the
   * board was already serving, which made a recording that had not been submitted — a fresh one
   * from tools/, a blob attached to a bug report — impossible to look at without editing code.
   *
   * Same-origin only, and deliberately so: the parameter is in a URL, which means anyone can
   * hand you one, and resolving it against another host would turn the page into a fetcher for
   * whoever wrote the link. A tape is also not trusted input once fetched — it goes through
   * `watch`, which decodes inside a try and re-simulates rather than believing anything it says.
   */
  const watchTapeParam = async (): Promise<boolean> => {
    const param = new URLSearchParams(location.search).get('tape');
    if (!param) return false;
    const url = new URL(param, location.href);
    if (url.origin !== location.origin) {
      console.warn('?tape= only opens recordings from this origin, not', url.origin);
      return false;
    }
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`no recording at ${url.pathname}: ${res.status}`);
      return false;
    }
    watch(new Uint8Array(await res.arrayBuffer()), url.pathname.split('/').pop() ?? 'a recording');
    return true;
  };

  const startAttract = async () => {
    await backgroundsReady;
    await showBestRun();
    // The attract loop would be playing behind the viewer, which is work nobody can see.
    if (await watchTapeParam()) return;
    if (!playing && !matchMedia('(prefers-reduced-motion: reduce)').matches) hero.start();
  };
  void startAttract();

  el('attract-watch').addEventListener('click', () => {
    const source = hero.current;
    if (source) watch(source.bytes, source.bundled ? 'Demonstration run' : 'The record to beat');
  });

  /* --- playing ------------------------------------------------------------- */

  const startGame = async () => {
    await backgroundsReady;
    await audio.ready;
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
    sounds()?.playStart();
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
      let why = 'Sign in and your runs will count.';
      if (api.account) {
        why = api.account.verified
          ? 'The board was out of reach when this run started.'
          : 'Confirm your e-mail address and your runs will count.';
      }
      view.setState(score.toLocaleString(), [`Not recorded. ${why}`, AGAIN]);
      return;
    }

    view.setState(score.toLocaleString(), ['Verifying…']);
    const result = await api.submitRun(grant, recorder.bytes());
    grant = null;

    if (result.ok) {
      // The board is its own page now, so the run cannot be shown landing on it from here.
      // It is carried over instead: `?fresh=` is what highlights the row once there. The board
      // holds each player's best, so a run that was not one is only on the list of every run,
      // and the link goes where the row is rather than to a board it is missing from.
      const fresh = encodeURIComponent(result.run.id);
      view.setState(
        result.run.score.toLocaleString(),
        [
          result.best
            ? `Verified. Number ${result.rank} on the board.`
            : `Verified. Number ${result.runRank} of every run; your best still stands.`,
          AGAIN,
        ],
        result.best
          ? { href: `/records?fresh=${fresh}`, text: 'See it on the board' }
          : { href: `/player-highscores?fresh=${fresh}`, text: 'See it among every run' },
      );
      return;
    }

    const because =
      result.code === 'no-score'
        ? 'No lines cleared, so nothing to record.'
        : result.code === 'duplicate'
          ? 'Already on the board.'
          : isUnreachable(result)
            ? 'The board could not be reached.'
            : `The board would not take it (${result.code}).`;
    view.setState(score.toLocaleString(), [because, AGAIN]);
    if (result.code === 'unverifiable') console.warn('run did not verify:', result.message);
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const delta = Math.min(now - last, 250);
    last = now;
    if (!playing || !game || viewer.isOpen) return;

    if (!game.isOver) game.advance(delta);
    else if (!submitted) void submitRun();

    const player = sounds();
    if (player) {
      // The level picks the sample theme, as Canvas::change_level does in the original.
      player.level = game.canvas.level;
      player.play(game.drainSounds());
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
    if (viewer.isOpen || identity.account.isOpen) return;
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
    else if (e.code === 'KeyW' && game.isOver) watch(recorder?.bytes() ?? null, 'Your last run');
    else if (e.code === 'KeyP') {
      game.paused = !game.paused;
      if (game.paused) view.setState('Paused', ['Press P to carry on.']);
      else view.clearState();
      sounds()?.playPause();
    }
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
      start: () => startGame(),
      leave: leaveGame,
      step(frames = 1) {
        if (!game) return null;
        for (let i = 0; i < frames; i++) game.stepFrame(1);
        if (game.isOver && !submitted) submitRun();
        sounds()?.play(game.drainSounds());
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

main().catch((err: unknown) => {
  console.error(err);
  const lede = document.getElementById('attract-lede');
  if (lede) lede.textContent = `Something failed to load: ${String(err)}`;
});
