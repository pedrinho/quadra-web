/*
 * The board of records.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A row is not a score. It is the recording of a run, and the number shown is what the engine
 * reached when it last played those inputs back. So every row carries a *verify* control: it
 * re-simulates the tape then and there and reports the frames, the milliseconds and the state
 * hash it arrived at. That is the whole claim of this port, made checkable in one press rather
 * than asserted in a paragraph.
 */

import { TICK_MS } from '../engine/game.js';
import { isStale, loadRuns, tapeOf, type StoredRun } from '../leaderboard.js';
import { verify } from '../replay/verify.js';

export interface RecordsOptions {
  list: HTMLElement;
  empty: HTMLElement;
  onWatch: (run: StoredRun) => void;
}

export class Records {
  private justPlayed: string | null = null;

  constructor(private readonly opts: RecordsOptions) {}

  refresh(justPlayed: string | null = this.justPlayed): void {
    this.justPlayed = justPlayed;
    const runs = loadRuns();
    this.opts.list.replaceChildren(...runs.map((run, i) => this.row(run, i + 1)));
    this.opts.empty.hidden = runs.length > 0;
  }

  private row(run: StoredRun, rank: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'record';
    if (run.id === this.justPlayed) li.classList.add('is-fresh');

    li.append(
      span('rank', String(rank).padStart(2, '0')),
      span('score', run.score.toLocaleString()),
      span('detail', detail(run)),
    );

    const verdict = document.createElement('p');
    verdict.className = 'verdict';
    verdict.hidden = true;

    const actions = document.createElement('span');
    actions.className = 'row-actions';

    if (isStale(run)) {
      // Kept on the board, but this build's engine is not the one that recorded it, so replaying
      // it would produce a different game and calling that "the run" would be a lie.
      verdict.hidden = false;
      verdict.textContent = 'Recorded by an older engine — it can no longer be replayed.';
    } else {
      actions.append(
        button('Watch', () => this.opts.onWatch(run)),
        button('Verify', (el) => this.check(run, el, verdict)),
        button('Copy', (el) => this.copy(run, el)),
      );
    }

    li.append(actions, verdict);
    return li;
  }

  /** Re-simulate the row in front of whoever pressed it. */
  private check(run: StoredRun, trigger: HTMLButtonElement, verdict: HTMLElement): void {
    const bytes = tapeOf(run);
    verdict.hidden = false;
    if (!bytes) {
      verdict.dataset['state'] = 'bad';
      verdict.textContent = 'The recording behind this row is unreadable.';
      return;
    }

    trigger.disabled = true;
    const started = performance.now();
    const result = verify(bytes);
    const took = performance.now() - started;
    trigger.disabled = false;

    if (!result.ok) {
      verdict.dataset['state'] = 'bad';
      verdict.textContent = `Does not verify: ${result.code} at frame ${result.frame}.`;
      return;
    }
    if (result.score !== run.score) {
      // The tape is valid but no longer reaches the score on the board — which is exactly the
      // failure this design exists to catch, so it is reported rather than smoothed over.
      verdict.dataset['state'] = 'bad';
      verdict.textContent =
        `Replays to ${result.score.toLocaleString()}, not ${run.score.toLocaleString()}. ` +
        'The engine has changed under this recording.';
      return;
    }

    verdict.dataset['state'] = 'ok';
    verdict.textContent =
      `Re-simulated ${result.frames.toLocaleString()} frames in ${took.toFixed(1)} ms · ` +
      `${result.score.toLocaleString()} points · ${result.stateHash}`;
  }

  private copy(run: StoredRun, trigger: HTMLButtonElement): void {
    const done = (text: string) => {
      trigger.textContent = text;
      setTimeout(() => (trigger.textContent = 'Copy'), 1400);
    };
    void navigator.clipboard?.writeText(run.tape).then(
      () => done('Copied'),
      () => done('Blocked'),
    );
  }
}

function detail(run: StoredRun): string {
  const seconds = (run.ticks * TICK_MS) / 1000;
  const when = run.startedAt || run.savedAt;
  const parts = [
    `${run.lines} ${run.lines === 1 ? 'line' : 'lines'}`,
    `level ${run.level}`,
    formatDuration(seconds),
    when ? new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
  ];
  if (!run.over) parts.push('unfinished');
  return parts.filter(Boolean).join(' · ');
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function button(label: string, onClick: (el: HTMLButtonElement) => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'link';
  el.textContent = label;
  el.addEventListener('click', () => onClick(el));
  return el;
}
