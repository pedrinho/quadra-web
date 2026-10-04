/*
 * Browser entry point for the board of records, and for the list of every run.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Its own document rather than a section of the stage, because a board is a thing you link
 * someone to. It carries no game and no attract loop — the only moving thing here is a run being
 * watched, and it is watched through the same `Screen`, the same `ReplayViewer` and the same
 * engine the game is played with. A page that could show a board the engine cannot produce would
 * be worth nothing, which is the whole reason the viewer draws through shared code.
 *
 * `/records` is the board, one row per player; `/player-highscores` is every run, the board as it
 * was before a name could only appear on it once. Same rail, same rows, a different question.
 */

import './styles.css';

import { Canvas } from './engine/canvas.js';
import { loadQfnt } from './render/font.js';
import { Screen, PLAYFIELD_VIEW } from './render/screen.js';
import { ReplayViewer } from './ui/replay-viewer.js';
import { Records } from './ui/records.js';
import { Api, type BoardRun } from './api.js';
import { decodeTape } from './replay/tape.js';
import { parseRec, RecError, recRefusal } from './replay/rec.js';
import { RecPlayer } from './replay/rec-playback.js';
import { loadSettings, saveSettings } from './settings.js';
import {
  createAudio,
  createIdentity,
  createImages,
  createMuting,
  el,
  loadBackgrounds,
  maybeEl,
  paintGround,
  paintLettering,
  readSignInLink,
  takeParam,
} from './shell.js';

async function main(): Promise<void> {
  const boardEl = el<HTMLCanvasElement>('screen');
  boardEl.width = PLAYFIELD_VIEW.width;
  boardEl.height = PLAYFIELD_VIEW.height;
  const ctx = boardEl.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('could not get a 2d context');
  ctx.imageSmoothingEnabled = false;

  const image = createImages();
  const font = await loadQfnt('assets/font.qfnt');

  void paintLettering(image);
  /* Its two headings are painted in at y 15-30 and y 225-240; everything below is fireworks. */
  void image('hscore').then((art) =>
    paintGround(el<HTMLCanvasElement>('records-ground'), art, {
      x: 0,
      y: 270,
      width: 640,
      height: 210,
    }),
  );

  const { backgrounds, ready } = loadBackgrounds(image, (level) => {
    // A run reaching level nine before its backdrop lands would otherwise be watched against
    // level one's, silently — `Screen` caches the level it drew.
    if (viewer.isOpen && viewer.level === level) screen.invalidate();
  });

  const audio = createAudio();
  const screen = new Screen(ctx, backgrounds, font);
  const settings = loadSettings();
  const api = new Api();

  const applyVolume = () => {
    saveSettings(settings);
    audio.applyVolume(settings);
  };
  applyVolume();

  const rail = el('rail');

  /*
   * The board is on the page whether or not anything is playing, so it needs something to be
   * when it is not: an untouched well on level one's backdrop. A fresh `Canvas` is exactly that
   * — empty board, no piece, no queue — and drawing it is how the page returns from a replay
   * rather than leaving the last frame watched frozen on screen.
   */
  const idle = new Canvas();
  const drawIdle = (): void => {
    screen.invalidate();
    screen.draw(idle);
  };
  void ready.then(drawIdle);

  const viewer = new ReplayViewer({
    // Inside the rail, so the transport sits under the board rather than over the rows.
    host: rail,
    screen,
    sounds: audio.sounds,
    muting: createMuting(settings, applyVolume),
    onVisibility: (open) => {
      rail.classList.toggle('is-playing', open);
      if (open) screen.invalidate();
      else drawIdle();
    },
  });

  // Two documents share this entry: the board, a row per player, and the list of every run.
  // The list says which it is.
  const list = el('records-list');
  const records = new Records({
    list,
    empty: el('records-empty'),
    api,
    each: list.dataset['each'] === 'run' ? 'run' : 'player',
    onWatch: (run: BoardRun) => {
      void api.tape(run.id).then((res) => {
        if (!res.ok) return;
        try {
          viewer.show(decodeTape(res.bytes), `${run.player} · ${run.score.toLocaleString()}`);
        } catch (err) {
          // A stored recording that no longer decodes is a bug or a hand-edited blob, not a
          // reason to take the page down.
          console.warn('could not open that replay:', err);
        }
      });
    },
  });

  // Only the board offers it. The list of every run is about this game's runs, not 1998's.
  const recFile = maybeEl<HTMLInputElement>('rec-file');
  if (recFile) openRecDemos(recFile, el('rec-note'), viewer);

  const identity = createIdentity({
    api,
    // Who is looking decides which row is theirs, so the board is rebuilt when that changes.
    onAccount: () => void records.refresh(),
  });

  /*
   * `?fresh=<id>` is how a run just played reaches the board it landed on: the game is on the
   * other document now, so it cannot highlight the row itself. Read and stripped in one go, as
   * the mailed links are — a highlight that survived a reload would be lying about which run
   * was just played.
   */
  const fresh = takeParam('fresh');

  // Before the first refresh rather than alongside it: the rows read `api.account` to decide
  // which one is yours, so a board built first would paint that wrong and never correct it.
  const who = await api.refresh();
  identity.paint(who);
  readSignInLink(identity.account);
  await records.refresh(fresh);

  /* Dev hook, as the stage has: audio is invisible from outside, and whether a replay is
   * actually sounding is otherwise only answerable by listening to it. */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__quadra = { records, viewer, audio, settings };
  }
}

/* --- 1998 recordings ------------------------------------------------------
 *
 * A `.rec` is what the original game wrote, and it plays here for the same reason a row does:
 * it is a seed and a list of moves, and the board is recomputed from them. It is never turned
 * into a tape and can never reach the leaderboard — see replay/rec.ts. What it can do is show
 * whether this engine still plays the game the 1998 one played, which is a question only
 * somebody else's recording can answer.
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
      viewer.showSource(player, who ? `${who} · ${file.name}` : file.name);
      say(invitation);
    } catch (err) {
      // A `.rec` comes off a stranger's disk, so failing to read one is expected traffic rather
      // than a bug: say which way it failed and leave the page up.
      say(
        err instanceof RecError ? `That file is not a playable .rec: ${err.message}` : String(err),
        true,
      );
    }
  };

  input.addEventListener('change', function () {
    const file = this.files?.[0];
    // Cleared, so picking the same file twice in a row still fires `change` the second time.
    this.value = '';
    if (file) void openRec(file);
  });

  // The whole document, not just the rail: a drop target the size of a button is a target people
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
  const empty = document.getElementById('records-empty');
  if (empty) {
    empty.hidden = false;
    empty.textContent = `Something failed to load: ${String(err)}`;
  }
});
