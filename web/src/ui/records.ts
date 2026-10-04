/*
 * The board of records.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A row is not a score. It is the recording of a run, and the number shown is what the *server*
 * reached when it played those inputs back — the client never got to say. So the one control a
 * row carries is *watch*: it fetches the recording and hands it to the viewer, which re-simulates
 * it on the board beside the list, through the engine the game is played with. That is the whole
 * claim of this port, shown rather than asserted, and now against somebody else's run rather than
 * only your own.
 */

import { TICK_MS } from '../engine/game.js';
import { apiMessage, isUnreachable, type Api, type BoardRun } from '../api.js';
import { formatDuration } from './format.js';

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

    // A span of its own for one button, because `margin-left: auto` on it is what holds the
    // control against the right edge of the row.
    const actions = document.createElement('span');
    actions.className = 'row-actions';
    actions.append(button('Watch', () => this.opts.onWatch(run)));

    li.append(actions);
    return li;
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

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'link';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}
