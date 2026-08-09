/*
 * The board of records.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A row is not a score. It is the recording of a run, and the number shown is what the *server*
 * reached when it played those inputs back — the client never got to say. So every row carries a
 * *verify* control: it fetches the recording, re-simulates it here, and reports the frames, the
 * milliseconds and the state hash it arrived at. That is the whole claim of this port, made
 * checkable in one press rather than asserted in a paragraph, and now it is checkable against
 * somebody else's run rather than only your own.
 */

import { TICK_MS } from '../engine/game.js';
import { verify } from '../replay/verify.js';
import { apiMessage, isUnreachable, type Api, type BoardRun } from '../api.js';

export interface RecordsOptions {
  list: HTMLElement;
  empty: HTMLElement;
  api: Api;
  onWatch: (run: BoardRun) => void;
}

export class Records {
  private justPlayed: string | null = null;
  /** Bumped per refresh, so a slow response for an old request cannot overwrite a newer board. */
  private generation = 0;

  constructor(private readonly opts: RecordsOptions) {}

  async refresh(justPlayed: string | null = this.justPlayed): Promise<void> {
    this.justPlayed = justPlayed;
    const mine = ++this.generation;

    this.opts.empty.hidden = false;
    this.opts.empty.textContent = 'Loading the board…';

    const result = await this.opts.api.leaderboard('all', 20);
    if (mine !== this.generation) return;

    if (!result.ok) {
      this.opts.list.replaceChildren();
      this.opts.empty.textContent = isUnreachable(result)
        ? 'The board is not reachable from here. The game still plays.'
        : `The board could not be loaded: ${apiMessage(result)}`;
      return;
    }

    this.opts.list.replaceChildren(...result.runs.map((run) => this.row(run)));
    this.opts.empty.hidden = result.runs.length > 0;
    this.opts.empty.textContent = 'Nobody has scored yet. Be the first.';
  }

  private row(run: BoardRun): HTMLElement {
    const li = document.createElement('li');
    li.className = 'record';
    if (run.id === this.justPlayed) li.classList.add('is-fresh');
    if (this.opts.api.account && run.player === this.opts.api.account.displayName) {
      li.classList.add('is-mine');
    }

    li.append(
      span('rank', String(run.rank).padStart(2, '0')),
      span('score', run.score.toLocaleString()),
      span('player', run.player),
      span('detail', detail(run)),
    );

    const verdict = document.createElement('p');
    verdict.className = 'verdict';
    verdict.hidden = true;

    const actions = document.createElement('span');
    actions.className = 'row-actions';
    actions.append(
      button('Watch', () => this.opts.onWatch(run)),
      button('Verify', (el) => void this.check(run, el, verdict)),
    );

    li.append(actions, verdict);
    return li;
  }

  /** Fetch the row's recording and re-simulate it in front of whoever pressed it. */
  private async check(
    run: BoardRun,
    trigger: HTMLButtonElement,
    verdict: HTMLElement,
  ): Promise<void> {
    verdict.hidden = false;
    verdict.dataset['state'] = '';
    verdict.textContent = 'Fetching the recording…';
    trigger.disabled = true;

    const tape = await this.opts.api.tape(run.id);
    if (!tape.ok) {
      trigger.disabled = false;
      verdict.dataset['state'] = 'bad';
      verdict.textContent = `Could not fetch the recording: ${apiMessage(tape)}`;
      return;
    }

    const started = performance.now();
    const result = verify(tape.bytes);
    const took = performance.now() - started;
    trigger.disabled = false;

    if (!result.ok) {
      verdict.dataset['state'] = 'bad';
      verdict.textContent = `Does not verify: ${result.code} at frame ${result.frame}.`;
      return;
    }
    if (result.score !== run.score) {
      // The tape is valid but this engine no longer reaches the score the board is showing —
      // exactly the failure this design exists to catch, so it is reported rather than smoothed
      // over. In practice it means the browser and the server are not running the same build.
      verdict.dataset['state'] = 'bad';
      verdict.textContent =
        `Replays to ${result.score.toLocaleString()}, not ${run.score.toLocaleString()}. ` +
        'This browser and the board do not agree on the engine.';
      return;
    }

    verdict.dataset['state'] = 'ok';
    verdict.textContent =
      `Re-simulated ${result.frames.toLocaleString()} frames in ${took.toFixed(1)} ms · ` +
      `${result.score.toLocaleString()} points · ${result.stateHash}`;
  }
}

function detail(run: BoardRun): string {
  const seconds = (run.ticks * TICK_MS) / 1000;
  const when = run.startedAt || run.verifiedAt;
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
