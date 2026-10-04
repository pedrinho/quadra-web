/*
 * Browser entry point: the whole app, whichever of its four documents it was loaded through.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * One board in the middle of the screen, and three things it can be showing: a run replaying
 * itself (the attract loop), your game, or a run you asked to watch. Around it, a menu that never
 * changes and a panel that changes with the view — Play, the leaderboard, About. Moving between
 * views swaps the panel and nothing else, so the board, its art, the sound and a game in progress
 * all survive it.
 *
 * The 1998 art lives on the board and nowhere else. The framebuffer draws the playfield; every
 * word around it is the page's.
 */

import './styles.css';

import { Game, TICK_MS } from './engine/game.js';
import type { QImage } from './render/qimg.js';
import { loadQfnt } from './render/font.js';
import { Screen, PLAYFIELD_VIEW } from './render/screen.js';
import { Keyboard } from './input/keyboard.js';
import { loadSettings, saveSettings } from './settings.js';
import { SettingsPanel, renderBindings } from './ui/settings-panel.js';
import { ReplayViewer } from './ui/replay-viewer.js';
import { Hero } from './ui/hero.js';
import { GameView } from './ui/game-view.js';
import { Records, renderTopRuns } from './ui/records.js';
import { Api, apiMessage, isUnreachable, type Account, type BoardRun } from './api.js';
import { decodeTape } from './replay/tape.js';
import { record, type TapeRecorder } from './replay/recorder.js';
import { parseRec, RecError, recRefusal } from './replay/rec.js';
import { RecPlayer } from './replay/rec-playback.js';
import { Router, type Route } from './router.js';
import {
  createAudio,
  createIdentity,
  createImages,
  createMuting,
  el,
  loadBackgrounds,
  paintVersion,
  readSignInLink,
  takeParam,
} from './shell.js';

const TITLES: Record<Route, string> = {
  play: 'Quadra, the 1998 puzzle game in your browser',
  board: 'Leaderboard · Quadra',
  runs: 'Every run · Quadra',
  about: 'How it works · Quadra',
};

const isList = (route: Route): boolean => route === 'board' || route === 'runs';

async function main(): Promise<void> {
  const boardEl = el<HTMLCanvasElement>('screen');
  boardEl.width = PLAYFIELD_VIEW.width;
  boardEl.height = PLAYFIELD_VIEW.height;
  const ctx = boardEl.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('could not get a 2d context');
  ctx.imageSmoothingEnabled = false;

  const image = createImages();
  // The game's own bitmap face, for what it draws on the board itself.
  const font = await loadQfnt('assets/font.qfnt');
  paintVersion();

  const { backgrounds, ready: backgroundsReady } = loadBackgrounds(image, (level) => {
    // `Screen` caches the level it drew, so a backdrop that lands late needs asking for.
    if ((game && game.canvas.level === level) || (viewer.isOpen && viewer.level === level)) {
      screen.invalidate();
    }
  });
  let pauseBadge: QImage | null = null;
  void image('gamepaus').then((img) => (pauseBadge = img));

  const audio = createAudio();
  const { sounds } = audio;

  const screen = new Screen(ctx, backgrounds, font);
  const settings = loadSettings();
  const keyboard = new Keyboard(settings.keys);
  const api = new Api();

  const view = new GameView({
    stripAttract: el('strip-attract'),
    stripGame: el('strip-game'),
    stripScore: el('game-score'),
    title: el('game-title'),
    state: el('run-state'),
    restart: el('hud-restart'),
    hint: el('game-hint'),
    score: el('score'),
    lines: el('lines'),
    level: el('level'),
    chain: el('chain'),
  });

  const hero = new Hero(screen, {
    section: el('stage'),
    title: el('attract-title'),
    score: el('attract-score'),
    by: el('attract-by'),
    watch: el('attract-watch'),
  });

  let route: Route = 'play';
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

  /* --- what the keyboard reaches ------------------------------------------- */

  /*
   * The game hears the keys only while it is on screen and nothing is over it. Anything else —
   * a panel open, a replay up, another view in the panel — and they belong to that.
   */
  let overlays = 0;
  let pausedBeforeOverlay = false;
  const syncKeyboard = (): void => {
    if (playing && overlays === 0 && route === 'play') keyboard.resume();
    else keyboard.suspend();
  };
  const onOverlay = (open: boolean): void => {
    if (open) {
      if (overlays === 0) {
        pausedBeforeOverlay = game?.paused ?? false;
        if (game) game.paused = true;
      }
      overlays++;
    } else {
      overlays = Math.max(0, overlays - 1);
      // Back where it was — unless the panel has moved to another view meanwhile, in which case
      // it stays paused until you come back and press P.
      if (overlays === 0 && game && playing && route === 'play') game.paused = pausedBeforeOverlay;
    }
    syncKeyboard();
  };

  const settingsPanel = new SettingsPanel({
    host: document.body,
    settings,
    onChange: applySettings,
    onVisibility: onOverlay,
  });

  /* --- the panel ----------------------------------------------------------- */

  const sections = {
    idle: el('play-idle'),
    game: el('play-game'),
    board: el('view-board'),
    about: el('view-about'),
  };

  const renderPanel = (): void => {
    const shown = route === 'play' ? (playing ? 'game' : 'idle') : isList(route) ? 'board' : 'about';
    for (const [name, section] of Object.entries(sections)) section.hidden = name !== shown;
    const nav = isList(route) ? 'board' : route;
    for (const a of document.querySelectorAll<HTMLElement>('.menu a[data-nav]')) {
      if (a.dataset['nav'] === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    for (const a of document.querySelectorAll<HTMLElement>('.tabs a[data-tab]')) {
      if (a.dataset['tab'] === (route === 'runs' ? 'run' : 'player')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };

  /** Under Play: what signing in would change, for whoever is looking. */
  const paintRankHint = (who: Account | null): void => {
    el('rank-hint').textContent = !who
      ? 'Sign in and your runs go on the leaderboard.'
      : who.verified
        ? `Signed in as ${who.displayName}. Your runs go on the leaderboard.`
        : 'Confirm your e-mail address and your runs will count.';
  };

  const topRuns = el('top-runs');
  const loadTopRuns = async (): Promise<void> => {
    const result = await api.leaderboard('all', 5, 'run');
    if (result.ok && result.runs.length) {
      renderTopRuns(topRuns, result.runs);
      return;
    }
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = result.ok
      ? 'No runs yet. Yours could be the first.'
      : 'The leaderboard is not reachable from here. The game still plays.';
    topRuns.replaceChildren(li);
  };

  /* --- watching ------------------------------------------------------------ */

  const strip = el('strip');
  const viewer = new ReplayViewer({
    // Under the board, in the line the caption otherwise takes.
    host: strip,
    screen,
    sounds,
    muting: createMuting(settings, applySettings),
    onVisibility: (open) => {
      strip.classList.toggle('is-replay', open);
      onOverlay(open);
      if (open) {
        hero.stop();
        return;
      }
      records.setWatching(null);
      if (!playing) {
        hero.paint();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) hero.start();
      } else {
        screen.invalidate();
      }
    },
  });

  const watch = (bytes: Uint8Array | null, label: string, id: string | null = null): void => {
    if (!bytes) return;
    try {
      viewer.show(decodeTape(bytes), label);
      records.setWatching(id);
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
    each: 'player',
    onWatch: (run: BoardRun) => {
      void api.tape(run.id).then((res) => {
        if (res.ok) watch(res.bytes, `${run.player}, ${run.score.toLocaleString()}`, run.id);
      });
    },
  });

  const identity = createIdentity({
    api,
    onAccount: (who) => {
      paintRankHint(who);
      // "The record to beat" and "yours" on the board are both about who is looking.
      if (!playing && !viewer.isOpen) void startAttract();
      if (isList(route)) void records.refresh();
    },
    onVisibility: onOverlay,
  });

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
   * The board plays the best run on the leaderboard, or the recording shipped with the build when
   * the board is empty or out of reach. Either way it is the engine replaying a tape, which is the
   * page's argument as much as its decoration.
   */
  const showBestRun = async (): Promise<void> => {
    const board = await api.leaderboard('all', 1);
    const best = board.ok ? board.runs[0] : undefined;
    if (best) {
      const tape = await api.tape(best.id);
      if (tape.ok) {
        try {
          hero.show({ bytes: tape.bytes, tape: decodeTape(tape.bytes), bundled: false, by: best.player });
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
   * `?tape=<path>` opens a recording straight in the viewer, so a recording that was never
   * submitted — a fresh one from tools/, a blob attached to a bug report — can be watched.
   *
   * Same-origin only, and deliberately so: the parameter is in a URL, which means anyone can hand
   * you one, and resolving it against another host would turn the page into a fetcher for
   * whoever wrote the link. A tape is also not trusted input once fetched — `watch` decodes it
   * inside a try and re-simulates rather than believing anything it says.
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
    watch(new Uint8Array(await res.arrayBuffer()), url.pathname.split('/').pop() ?? 'A recording');
    return true;
  };

  const startAttract = async (): Promise<void> => {
    await backgroundsReady;
    await showBestRun();
    if (await watchTapeParam()) return;
    if (!playing && !viewer.isOpen && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      hero.start();
    }
  };

  el('attract-watch').addEventListener('click', () => {
    const source = hero.current;
    if (source) watch(source.bytes, source.bundled ? 'Demonstration run' : 'The record to beat');
  });

  /* --- playing ------------------------------------------------------------- */

  const startGame = async (): Promise<void> => {
    await backgroundsReady;
    await audio.ready;
    viewer.hide();
    hero.stop();

    // Ask for a seed if this run can count. If it cannot — signed out, unconfirmed, or the
    // service is not answering — fall back to a local seed and play anyway. A game that will
    // not start because a leaderboard is down is a worse game.
    grant = null;
    let seed: number | bigint = Date.now() & 0x7fffffff;
    let why = 'Playing as a guest. This run will not be ranked.';
    if (api.account && !api.account.verified) {
      why = 'Not ranked: confirm your e-mail address first.';
    } else if (api.account?.verified) {
      const issued = await api.startRun();
      if (issued.ok) {
        grant = issued.grant;
        seed = BigInt(issued.seed);
      } else {
        why = 'Not ranked: the leaderboard is out of reach.';
        if (!isUnreachable(issued)) console.warn('playing unranked:', apiMessage(issued));
      }
    }
    el('game-who').textContent = api.account?.displayName ?? 'You';
    el('game-status').textContent = grant ? 'ranked run' : 'not ranked';
    el('game-hint').textContent = grant ? 'This run goes on the leaderboard when it ends.' : why;

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
    submitted = false;
    playing = true;
    view.show(true);
    if (route !== 'play') router.go('/');
    renderPanel();
    syncKeyboard();
    screen.invalidate();
    // Discard anything queued during construction.
    fresh.drainSounds();
    fresh.drainNotices();
    sounds()?.playStart();
  };

  const leaveGame = (): void => {
    playing = false;
    game = null;
    keyboard.dispose();
    view.show(false);
    renderPanel();
    syncKeyboard();
    screen.invalidate();
    void startAttract();
  };

  /**
   * Offer the finished run to the board.
   *
   * The score is not submitted — the recording is, and the server verifies it and derives the
   * score itself. What comes back is where the run landed, which nobody here could have chosen.
   */
  const submitRun = async (): Promise<void> => {
    submitted = true;
    view.setOver(true);
    if (!recorder) return;
    const ended = game;

    if (!grant) {
      // Nothing was sent and nothing was kept, so the panel is the only place this run is shown.
      let why = 'Sign in and your runs will count.';
      if (api.account) {
        why = api.account.verified
          ? 'The board was out of reach when this run started.'
          : 'Confirm your e-mail address and your runs will count.';
      }
      view.setState(`Not recorded. ${why}`);
      return;
    }

    view.setState('Verifying…');
    // Spent before the wait, not after it: a game started meanwhile has a grant of its own.
    const spent = grant;
    grant = null;
    const result = await api.submitRun(spent, recorder.bytes());
    if (result.ok) void loadTopRuns();
    else if (result.code === 'unverifiable') console.warn('run did not verify:', result.message);
    // Pressing R while it verified has started another game, and this verdict is not about that one.
    if (game !== ended) return;

    if (result.ok) {
      // `?fresh=` is what highlights the row once there. The board holds each player's best, so
      // a run that was not one is only on the list of every run, and the link goes where the row
      // is rather than to a board it is missing from.
      const fresh = encodeURIComponent(result.run.id);
      view.setState(
        result.best
          ? `Verified. Number ${result.rank} on the board.`
          : `Verified. Number ${result.runRank} of every run; your best still stands.`,
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
    view.setState(because);
  };

  const frame = (now: number): void => {
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
    // The game has stopped running by the time this has anything to do, so it goes by the clock.
    const wiped = screen.sweep.follow(game.canvas, delta);
    for (let i = 0; i < wiped; i++) player?.playWipeColumn();

    screen.scrollers?.follow(game);
    screen.draw(game.canvas);
    if (game.paused && pauseBadge) screen.drawPaused(pauseBadge);
    view.update(game);
  };
  requestAnimationFrame(frame);

  /* --- moving between views ------------------------------------------------ */

  /** Leaving Play mid-game pauses it, and it waits there, paused, for you to come back. */
  const pauseForAway = (): void => {
    if (!playing || !game || game.isOver || game.paused) return;
    game.paused = true;
    view.setState('Paused. Press P to carry on.');
    sounds()?.playPause();
  };

  const enter = (next: Route): void => {
    const previous = route;
    route = next;
    document.title = TITLES[next];
    if (previous === 'play' && next !== 'play') pauseForAway();
    // A replay belongs to the view it was opened from — except between the two lists, which are
    // one view with a switch on it.
    if (viewer.isOpen && !(isList(previous) && isList(next))) viewer.hide();
    if (isList(next)) {
      records.setEach(next === 'runs' ? 'run' : 'player');
      void records.refresh(takeParam('fresh'));
    }
    renderPanel();
    syncKeyboard();
    // For a screen reader the panel *is* the page that changed, so focus goes to its heading.
    const heading = document.querySelector<HTMLElement>('.pane .view:not([hidden]) h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  };

  const router = new Router(enter);
  route = router.route;
  document.title = TITLES[route];
  renderPanel();

  /* --- input --------------------------------------------------------------- */

  for (const trigger of document.querySelectorAll('[data-play]')) {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      void startGame();
    });
  }
  el('hud-restart').addEventListener('click', () => void startGame());
  el('hud-settings').addEventListener('click', () => settingsPanel.show());
  el('open-settings').addEventListener('click', () => settingsPanel.show());
  el('hud-leave').addEventListener('click', leaveGame);

  window.addEventListener('keydown', (e) => {
    if (viewer.isOpen || identity.account.isOpen) return;
    if (settingsPanel.isOpen) {
      if (e.code === 'Escape') {
        e.preventDefault();
        settingsPanel.hide();
      }
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      settingsPanel.show();
      return;
    }
    if (!playing || !game || route !== 'play') return;
    // A key the player bound to a game action wins over these.
    if (keyboard.isBound(e.code)) return;
    if (e.code === 'KeyR') void startGame();
    else if (e.code === 'KeyW' && game.isOver) watch(recorder?.bytes() ?? null, 'Your last run');
    else if (e.code === 'KeyP' && !game.isOver) {
      game.paused = !game.paused;
      if (game.paused) view.setState('Paused. Press P to carry on.');
      else view.clearState();
      sounds()?.playPause();
    }
  });

  openRecDemos(el<HTMLInputElement>('rec-file'), el('rec-note'), viewer);

  /* --- first paint --------------------------------------------------------- */

  // The account first: the rows read `api.account` to decide which one is yours, so a board
  // built before it would paint that wrong and never correct it.
  void api.refresh().then((who) => {
    identity.paint(who);
    paintRankHint(who);
    readSignInLink(identity.account);
    if (isList(route)) {
      records.setEach(route === 'runs' ? 'run' : 'player');
      void records.refresh(takeParam('fresh'));
    }
  });
  void loadTopRuns();
  void startAttract();

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
      viewer,
      records,
      router,
      audio,
      settings,
      start: () => startGame(),
      leave: leaveGame,
      step(frames = 1) {
        if (!game) return null;
        for (let i = 0; i < frames; i++) game.stepFrame(1);
        if (game.isOver && !submitted) void submitRun();
        sounds()?.play(game.drainSounds());
        screen.sweep.follow(game.canvas, frames * TICK_MS);
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

/* --- 1998 recordings ------------------------------------------------------
 *
 * A `.rec` is what the original game wrote, and it plays here for the same reason a row does: it
 * is a seed and a list of moves, and the board is recomputed from them. It is never turned into a
 * tape and can never reach the leaderboard — see replay/rec.ts. What it can do is show whether
 * this engine still plays the game the 1998 one played, which is a question only somebody else's
 * recording can answer.
 */
function openRecDemos(input: HTMLInputElement, note: HTMLElement, viewer: ReplayViewer): void {
  const say = (text: string, bad = false): void => {
    note.textContent = text;
    note.classList.toggle('is-error', bad);
  };
  const invitation = note.textContent ?? '';

  const openRec = async (file: File): Promise<void> => {
    say(`Reading ${file.name}…`);
    try {
      const demo = await parseRec(new Uint8Array(await file.arrayBuffer()));
      const refusal = recRefusal(demo);
      if (refusal) {
        say(refusal, true);
        return;
      }
      // Constructing the player runs the demo once to measure it, so a file that is going to
      // fail does so here, before the viewer is opened on it.
      const player = new RecPlayer(demo);
      const who = demo.info?.name.trim();
      viewer.showSource(player, who ? `${who}, ${file.name}` : file.name);
      say(invitation);
    } catch (err) {
      // A `.rec` comes off a stranger's disk, so failing to read one is expected traffic rather
      // than a bug: say which way it failed and leave the page up.
      say(err instanceof RecError ? `That file is not a playable .rec: ${err.message}` : String(err), true);
    }
  };

  input.addEventListener('change', function () {
    const file = this.files?.[0];
    // Cleared, so picking the same file twice in a row still fires `change` the second time.
    this.value = '';
    if (file) void openRec(file);
  });

  // The whole window, not just the button: a drop target the size of a button is one people
  // miss. `dragover` must be cancelled or the browser navigates to the file instead.
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('is-dropping');
  });
  document.addEventListener('dragleave', (e) => {
    // Only when the pointer has actually left the window — `dragleave` also fires crossing
    // between elements inside it, which would flicker the outline the whole way across.
    if (e.relatedTarget === null) document.body.classList.remove('is-dropping');
  });
  document.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    document.body.classList.remove('is-dropping');
    void openRec(file);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  const lede = document.getElementById('attract-lede');
  if (lede) lede.textContent = `Something failed to load: ${String(err)}`;
});
