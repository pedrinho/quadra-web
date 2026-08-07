/*
 * Browser entry point.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import { Game } from './engine/game.js';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './render/framebuffer.js';
import { loadQimg, type QImage } from './render/qimg.js';
import { Screen } from './render/screen.js';
import { Keyboard } from './input/keyboard.js';
import { Bloc } from './engine/bloc.js';
import { loadSettings, saveSettings } from './settings.js';
import { SettingsPanel, bindingsHelp } from './ui/settings-panel.js';
import { LeaderboardPanel } from './ui/leaderboard-panel.js';
import { ReplayViewer } from './ui/replay-viewer.js';
import { saveRun, tapeOf, type StoredRun } from './leaderboard.js';
import { decodeTape } from './replay/tape.js';
import { record, type TapeRecorder } from './replay/recorder.js';
import { verify } from './replay/verify.js';
import { createMixer, WebAudioMixer } from './audio/mixer.js';
import { loadSoundBank, type SoundBuffer } from './audio/sound-bank.js';
import { SoundPlayer } from './audio/sound-player.js';

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
};

async function main(): Promise<void> {
  const canvasEl = el<HTMLCanvasElement>('screen');
  canvasEl.width = SCREEN_WIDTH;
  canvasEl.height = SCREEN_HEIGHT;
  const ctx = canvasEl.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('could not get a 2d context');
  ctx.imageSmoothingEnabled = false;

  const status = el<HTMLElement>('status');
  status.textContent = 'loading…';

  // Backgrounds carry the palette the blocks are shaded from, so this must load before
  // anything is drawn.
  const backgrounds: QImage[] = [];
  for (let i = 0; i < 10; i++) backgrounds.push(await loadQimg(`assets/fond${i}.qimg`));

  // Audio is optional: a browser without Web Audio, or a checkout where the asset bank has
  // not been generated, must still leave the game fully playable.
  const { mixer, ctx: audioCtx } = createMixer();
  let bank: ReadonlyMap<string, SoundBuffer> = new Map();
  if (audioCtx) {
    try {
      bank = await loadSoundBank('assets/sounds.qsnd', audioCtx);
    } catch (err) {
      console.warn('sound disabled:', err);
    }
  }

  const screen = new Screen(ctx, backgrounds);
  const settings = loadSettings();
  const keyboard = new Keyboard(settings.keys);
  const sounds = new SoundPlayer(bank, mixer);

  let game: Game;
  let recorder: TapeRecorder;
  /** Set once the run has been offered to the board, so it is offered exactly once. */
  let submitted = false;

  const startGame = () => {
    game = new Game({
      seed: Date.now() & 0x7fffffff,
      level: 1,
      levelUp: true,
      shadow: true,
      hSensitivity: settings.hSensitivity,
      vSensitivity: settings.vSensitivity,
      continuous: settings.continuous,
      keys: settings.keys,
    });
    // Recording is on for every game and costs a few kilobytes a minute. A score is only worth
    // anything if the run behind it can be re-simulated, so the tape is the run — there is no
    // separate "start recording" to forget. The bypass guard is a development aid: in
    // production a stray direct write should cost an unverifiable score, not a crash.
    recorder = record(game, { guard: import.meta.env.DEV });
    // Through the sink, not straight at the canvas: everything that reaches the simulation
    // has to pass one seam, so the recorder sits on it.
    keyboard.attach(window, game.inputSink);
    submitted = false;
    screen.invalidate();
    game.drainSounds(); // discard anything queued during construction
    sounds.playStart();
  };
  startGame();

  const helpEl = el('keys');
  const applySettings = () => {
    saveSettings(settings);
    game.setSensitivity(settings.hSensitivity, settings.vSensitivity, settings.continuous);
    // Order matters: Keyboard pushes the bindings into the canvas, so its grouping wins.
    keyboard.setBindings(settings.keys);
    if (mixer instanceof WebAudioMixer) mixer.setVolume(settings.volume);
    helpEl.textContent = bindingsHelp(settings);
  };

  /* Any overlay pauses the game and takes the keyboard. They can be stacked — the board opens
   * over the game and a replay opens over the board — so this counts rather than toggles, and
   * restores the pause state rather than clearing it, so a game paused with P stays paused. */
  let overlays = 0;
  let pausedBeforeOverlay = false;
  const onOverlay = (open: boolean) => {
    if (open) {
      if (overlays === 0) {
        pausedBeforeOverlay = game.paused;
        game.paused = true;
        keyboard.suspend();
      }
      overlays++;
    } else {
      overlays = Math.max(0, overlays - 1);
      if (overlays === 0) {
        game.paused = pausedBeforeOverlay;
        keyboard.resume();
        screen.invalidate();
      }
    }
  };

  const panel = new SettingsPanel({
    host: document.body,
    settings,
    onChange: applySettings,
    onVisibility: onOverlay,
  });

  // A replay is watched *on the canvas*, so the board has to get out of the way and come back
  // afterwards rather than sit over the thing being watched.
  let reopenBoard = false;
  const viewer = new ReplayViewer({
    host: document.body,
    screen,
    onVisibility: (open) => {
      onOverlay(open);
      if (!open && reopenBoard) {
        reopenBoard = false;
        board.show();
      }
    },
  });

  const watch = (run: StoredRun) => {
    const bytes = tapeOf(run);
    if (!bytes) return;
    try {
      const tape = decodeTape(bytes);
      reopenBoard = board.isOpen;
      board.hide();
      viewer.show(tape, `${run.score.toLocaleString()} · ${run.lines} lines`);
    } catch (err) {
      // A stored tape that no longer decodes is a bug or a hand-edited blob, not something
      // worth taking the page down for.
      console.warn('could not open that replay:', err);
    }
  };

  const board = new LeaderboardPanel({
    host: document.body,
    onWatch: watch,
    onVisibility: onOverlay,
  });
  applySettings();

  const scoreEl = el('score');
  const linesEl = el('lines');
  const levelEl = el('level');
  const chainEl = el('chain');

  let bestChain = 0;
  let last = performance.now();

  let outcome = '';

  const render = () => {
    // The viewer owns the canvas while it is up, and draws its own game into it.
    if (!viewer.isOpen) screen.draw(game.canvas);

    bestChain = Math.max(bestChain, game.canvas.complexity);
    scoreEl.textContent = String(game.canvas.score);
    linesEl.textContent = String(game.canvas.linesTot);
    levelEl.textContent = String(game.canvas.level);
    chainEl.textContent = String(bestChain);
    status.textContent = game.isOver
      ? `game over — ${outcome} · W watches it back · R restarts · L opens the board`
      : game.paused
        ? 'paused'
        : '';
  };

  /**
   * Offer the finished run to the board.
   *
   * The score is not sent anywhere — the tape is, and the board verifies it and derives the
   * score itself. That is deliberately the same shape as the eventual submission to a server,
   * so the only thing that changes later is where the tape goes.
   */
  const submitRun = () => {
    submitted = true;
    const result = saveRun(recorder.bytes());
    if (result.ok) {
      outcome = `verified ${result.run.score.toLocaleString()} — #${result.rank} on this board`;
      board.show(result.run.id);
      return;
    }
    outcome =
      result.reason === 'not-a-record'
        ? 'not a top ten run'
        : result.reason === 'duplicate'
          ? 'already on the board'
          : `not verifiable (${result.reason})`;
    if (result.reason === 'unverifiable') console.warn('run did not verify:', result.message);
  };

  /** Everything a rendered frame does once the simulation has been advanced. */
  const afterFrame = () => {
    if (game.isOver && !submitted) submitRun();
    // The level picks the sample theme, as Canvas::change_level does in the original.
    sounds.level = game.canvas.level;
    sounds.play(game.drainSounds());
    render();
  };

  const frame = (now: number) => {
    const delta = Math.min(now - last, 250);
    last = now;
    if (!game.isOver) game.advance(delta);
    afterFrame();
    requestAnimationFrame(frame);
  };

  /* Dev hook. requestAnimationFrame is throttled to a stop in a background tab, so
   * automated checks cannot drive the game through the normal loop. This exposes a way to
   * advance a fixed number of simulation frames and redraw, which also makes the game
   * reproducible when debugging by hand. */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__quadra = {
      get game() {
        return game;
      },
      get recorder() {
        return recorder;
      },
      /**
       * Put this game's own recording through the verifier — the same call a server will make
       * on a submitted score. Comparing its answer against the live readout is the end-to-end
       * check that a run is worth submitting: same seed, same inputs, same score.
       */
      verifyTape() {
        const bytes = recorder.bytes();
        const started = performance.now();
        const result = verify(bytes);
        return {
          bytes: bytes.length,
          ms: Math.round(performance.now() - started),
          live: { score: game.canvas.score, lines: game.canvas.linesTot, frame: game.frame },
          verified: result,
        };
      },
      mixer,
      sounds,
      audioCtx,
      step(frames = 1) {
        for (let i = 0; i < frames; i++) game.stepFrame(1);
        // The same tail the rAF loop runs, so stepping by hand behaves like real play — the
        // sounds are drained, the run is submitted when it ends, and the screen is redrawn.
        afterFrame();
        return {
          score: game.canvas.score,
          lines: game.canvas.linesTot,
          level: game.canvas.level,
          frame: game.frame,
          over: game.isOver,
        };
      },
      /** Place a specific piece and hard-drop it — for reproducing captured positions. */
      place(piece: number, rot: number, col: number) {
        const probe = new Bloc(piece, -1, 0, 0);
        probe.rot = rot;
        let leftmost = 4;
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 4; c++) if (probe.grid()[r]![c]) leftmost = Math.min(leftmost, c);
        const b = new Bloc(piece, -1, 4 + col - leftmost, 10);
        b.rot = rot;
        // Reject placements that do not fit. Without this the piece overlaps a wall,
        // never descends, and gets stamped in mid-air — a state normal play cannot reach.
        if (game.canvas.checkCollide(b.quel, b.bx, b.by, b.rot)) return false;
        game.canvas.bloc = b;
        while (!game.canvas.checkCollide(b.quel, b.bx, b.by + 1, b.rot)) b.by++;
        b.calcXY();
        return true;
      },
      press(action: number) {
        game.input(action, true);
      },
      release(action: number) {
        game.input(action, false);
      },
    };
  }

  // Browsers hold an AudioContext suspended until the page sees a real user gesture, so
  // the first keypress or click is what actually switches sound on.
  const wakeAudio = () => {
    if (mixer instanceof WebAudioMixer) void mixer.resume();
  };
  window.addEventListener('keydown', wakeAudio);
  window.addEventListener('pointerdown', wakeAudio);

  window.addEventListener('keydown', (e) => {
    // The overlays handle their own Escape in the capture phase, so by the time it arrives
    // here none of them wanted it.
    if (e.code === 'Escape') {
      e.preventDefault();
      panel.toggle();
      return;
    }
    // A key the player bound to a game action wins over these hotkeys.
    if (keyboard.isBound(e.code) || panel.isOpen || board.isOpen || viewer.isOpen) return;
    if (e.code === 'KeyL') {
      board.show();
      return;
    }
    if (e.code === 'KeyW' && game.isOver) {
      // Watch the run just played, straight from the recorder — no round trip through storage,
      // so it works even for a run that did not make the board.
      viewer.show(recorder.tape(), 'your last run');
      return;
    }
    if (e.code === 'KeyR') {
      keyboard.dispose();
      bestChain = 0;
      outcome = '';
      startGame();
      applySettings();
    }
    if (e.code === 'KeyP') {
      game.paused = !game.paused;
      sounds.playPause();
    }
  });

  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `error: ${String(err)}`;
  console.error(err);
});
