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
import { loadQfnt, type Fontdata } from './render/font.js';
import { Screen, PLAYFIELD_VIEW } from './render/screen.js';
import {
  cropPixels,
  isMenuInk,
  labelCanvas,
  letteringCanvas,
  toCanvas,
} from './render/lettering.js';
import { Keyboard } from './input/keyboard.js';
import { loadSettings, saveSettings } from './settings.js';
import { SettingsPanel, bindingsHelp } from './ui/settings-panel.js';
import { ReplayViewer } from './ui/replay-viewer.js';
import { Records } from './ui/records.js';
import { Hero } from './ui/hero.js';
import { GameView } from './ui/game-view.js';
import { loadRuns, saveRun, tapeOf, type StoredRun } from './leaderboard.js';
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
  dressHeadings(font);

  void Promise.all([image('debuto'), image('debut0'), image('debut8')]).then(([menu, play, mark]) => {
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

    const signature = labelCanvas(mark, menu, SIGNATURE.x, SIGNATURE.y);
    signature.className = 'sprite-art';
    document.querySelector('[data-sprite="signature"]')?.prepend(signature);
  });
  void image('multi').then((art) => paintGround(el<HTMLCanvasElement>('ground'), art));

  const backgrounds: (QImage | undefined)[] = new Array<QImage | undefined>(LEVELS);
  const backgroundsReady = Promise.all(
    Array.from({ length: LEVELS }, async (_, i) => {
      backgrounds[i] = await image(`fond${i}`);
    }),
  );
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

  const screen = new Screen(ctx, backgrounds);
  const settings = loadSettings();
  const keyboard = new Keyboard(settings.keys);

  const view = new GameView({
    attract: el('attract'),
    hud: el('hud'),
    state: el('board-state'),
    score: el('score'),
    lines: el('lines'),
    level: el('level'),
    chain: el('chain'),
  });

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
    onWatch: (run: StoredRun) =>
      watch(tapeOf(run), `${run.score.toLocaleString()} · ${run.lines} lines`),
  });
  records.refresh();

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

  const showBestRun = async () => {
    const best = loadRuns()[0];
    if (best) {
      const bytes = tapeOf(best);
      if (bytes) {
        try {
          hero.show({ bytes, tape: decodeTape(bytes), bundled: false });
          return;
        } catch {
          /* fall through to the shipped recording */
        }
      }
    }
    const demo = await demoTape;
    hero.show({ ...demo, bundled: true });
  };

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
    const fresh = new Game({
      seed: Date.now() & 0x7fffffff,
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
    fresh.drainSounds(); // discard anything queued during construction
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
   * The score is not submitted anywhere — the recording is, and the board verifies it and
   * derives the score itself. That is deliberately the shape the eventual server call will
   * have, so the only thing that changes later is where the bytes go.
   */
  const submitRun = () => {
    submitted = true;
    if (!recorder) return;
    const result = saveRun(recorder.bytes());
    if (result.ok) {
      view.setState(
        `${result.run.score.toLocaleString()}`,
        `verified · number ${result.rank} on the board · press R to play again`,
      );
      records.refresh(result.run.id);
      return;
    }
    const because =
      result.reason === 'not-a-record'
        ? 'no lines cleared, so nothing to record'
        : result.reason === 'duplicate'
          ? 'already on the board'
          : `could not be verified (${result.reason})`;
    view.setState('Game over', `${because} · press R to play again`);
    if (result.reason === 'unverifiable') console.warn('run did not verify:', result.message);
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const delta = Math.min(now - last, 250);
    last = now;
    if (!playing || !game || viewer.isOpen) return;

    if (!game.isOver) game.advance(delta);
    else if (!submitted) submitRun();

    if (sounds) {
      // The level picks the sample theme, as Canvas::change_level does in the original.
      sounds.level = game.canvas.level;
      sounds.play(game.drainSounds());
    }

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
    if (viewer.isOpen) return;
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

/** Set every heading on the page in the game's own lettering. */
function dressHeadings(font: Fontdata): void {
  for (const heading of document.querySelectorAll<HTMLElement>('[data-lettering]')) {
    const text = heading.dataset['lettering'] ?? heading.textContent ?? '';
    const canvas = letteringCanvas(text, font, { color: [255, 255, 0], shadow: [0, 20, 40] });
    canvas.className = 'lettering-art';
    heading.prepend(canvas);
  }
}

/** A photograph from the game, laid in behind the stage as texture. */
function paintGround(canvas: HTMLCanvasElement, art: QImage): void {
  canvas.width = art.width;
  canvas.height = art.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pixels = cropPixels(art, 0, 0, art.width, art.height);
  const image = ctx.createImageData(art.width, art.height);
  image.data.set(pixels.rgba);
  ctx.putImageData(image, 0, 0);
}

main().catch((err: unknown) => {
  console.error(err);
  const lede = document.getElementById('attract-lede');
  if (lede) lede.textContent = `Something failed to load: ${String(err)}`;
});
