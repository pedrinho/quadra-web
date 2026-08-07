/*
 * The board of finished runs.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Every row is watchable, which is the point of the whole milestone: a score on this board is
 * not a claim about a game, it is the game. The rows come from `leaderboard.ts`, which stores
 * only tapes and re-derives everything shown here from them.
 */

import { TICK_MS } from '../engine/game.js';
import { isStale, loadRuns, clearRuns, type StoredRun } from '../leaderboard.js';

export interface LeaderboardPanelOptions {
  host: HTMLElement;
  /** Play this run back. */
  onWatch: (run: StoredRun) => void;
  onVisibility?: (open: boolean) => void;
}

export class LeaderboardPanel {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly onWatch: (run: StoredRun) => void;
  private readonly onVisibility: ((open: boolean) => void) | undefined;

  private highlight: string | null = null;
  private confirmingClear = false;

  constructor(opts: LeaderboardPanelOptions) {
    this.onWatch = opts.onWatch;
    this.onVisibility = opts.onVisibility;

    this.root = document.createElement('div');
    this.root.className = 'overlay leaderboard';
    this.root.hidden = true;

    const title = document.createElement('h2');
    title.textContent = 'Best runs';
    const close = button('close', () => this.hide());
    close.className = 'close';
    const head = document.createElement('header');
    head.append(title, close);

    this.list = document.createElement('ol');
    this.list.className = 'runs';

    this.empty = document.createElement('div');
    this.empty.className = 'hint';
    this.empty.textContent = 'No runs yet. Play one — every game is recorded.';

    this.clearButton = button('Clear board', () => this.clear());

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent =
      'Kept in this browser only. Each entry is the recording of the run, verified on save.';

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(this.clearButton);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.append(head, this.empty, this.list, actions, hint);
    this.root.append(panel);
    opts.host.append(this.root);

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show the board, optionally marking the run just played. */
  show(highlight: string | null = null): void {
    this.highlight = highlight;
    this.confirmingClear = false;
    this.render();
    if (this.root.hidden) {
      this.root.hidden = false;
      this.onVisibility?.(true);
    }
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onVisibility?.(false);
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  private clear(): void {
    // Two presses rather than a confirm dialog: a modal would block the game loop's keyboard
    // handling, and this is not a decision that deserves one.
    if (!this.confirmingClear) {
      this.confirmingClear = true;
      this.render();
      return;
    }
    clearRuns();
    this.confirmingClear = false;
    this.highlight = null;
    this.render();
  }

  private render(): void {
    const runs = loadRuns();
    this.list.replaceChildren();
    this.empty.hidden = runs.length > 0;
    this.clearButton.textContent = this.confirmingClear ? 'Clear board — sure?' : 'Clear board';
    this.clearButton.disabled = runs.length === 0;

    runs.forEach((run, i) => this.list.append(this.row(run, i + 1)));
  }

  private row(run: StoredRun, rank: number): HTMLElement {
    const el = document.createElement('li');
    el.className = 'run';
    if (run.id === this.highlight) el.classList.add('current');

    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = run.score.toLocaleString();

    const detail = document.createElement('span');
    detail.className = 'detail';
    const seconds = (run.ticks * TICK_MS) / 1000;
    const parts = [
      `${run.lines} lines`,
      `level ${run.level}`,
      formatDuration(seconds),
      formatDate(run.startedAt || run.savedAt),
    ];
    if (!run.over) parts.push('unfinished');
    if (isStale(run)) parts.push('older engine');
    detail.textContent = parts.join(' · ');

    const watch = button('watch', () => this.onWatch(run));
    watch.className = 'watch';
    // A run from a simulation this build no longer is would not replay to the score shown, so
    // it is kept and displayed but not offered for playback.
    watch.disabled = isStale(run);

    // The recording itself, so a run can leave this browser — `tools/verify-tape.ts` reads
    // exactly what this copies.
    const copy = button('copy', () => {
      void navigator.clipboard?.writeText(run.tape).then(
        () => {
          copy.textContent = 'copied';
          setTimeout(() => (copy.textContent = 'copy'), 1200);
        },
        () => (copy.textContent = 'blocked'),
      );
    });
    copy.title = 'Copy the recording (base64) to the clipboard';

    const rankEl = document.createElement('span');
    rankEl.className = 'rank';
    rankEl.textContent = `${rank}`;

    const buttons = document.createElement('span');
    buttons.className = 'row-actions';
    buttons.append(watch, copy);

    el.append(rankEl, score, detail, buttons);
    return el;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.code !== 'Escape') return;
    e.preventDefault();
    // Immediate: the host's Escape hotkey listens on `window` too, and would otherwise open
    // the settings panel on the same keypress that closed this one.
    e.stopImmediatePropagation();
    this.hide();
  };
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(ms: number): string {
  if (!ms) return 'unknown date';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
