/*
 * The board of records.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A row is not a score. It is the recording of a run, and the number shown is what the *server*
 * reached when it played those inputs back — the client never got to say. So the one control a
 * row carries is *watch*: it fetches the recording and hands it to the viewer, which re-simulates
 * it on the board in the middle of the screen, through the engine the game is played with.
 */

import { TICK_MS } from '../engine/game.js';
import { apiMessage, isUnreachable, type Api, type BoardEach, type BoardRun } from '../api.js';
import { formatDuration } from './format.js';
import { icon } from './icons.js';

/*
 * The board is one row per player, so twenty rows is twenty names. Every run is a longer list by
 * nature — one player's evening can be twenty rows on its own — so it takes as many as the
 * service will hand out.
 */
const LIMIT: Record<BoardEach, number> = { player: 20, run: 100 };

export interface RecordsOptions {
  list: HTMLElement;
  empty: HTMLElement;
  api: Api;
  /** `player` for the board, a row per name; `run` for every run there is. */
  each: BoardEach;
  onWatch: (run: BoardRun) => void;
}

export class Records {
  private justPlayed: string | null = null;
  private watching: string | null = null;
  private each: BoardEach;
  /** Bumped per refresh, so a slow response for an old request cannot overwrite a newer board. */
  private generation = 0;

  constructor(private readonly opts: RecordsOptions) {
    this.each = opts.each;
  }

  /** Switch between the two lists. They are one panel, so this is a refetch, not a new page. */
  setEach(each: BoardEach): void {
    if (each === this.each) return;
    this.each = each;
    this.opts.list.replaceChildren();
  }

  async refresh(justPlayed: string | null = this.justPlayed): Promise<void> {
    this.justPlayed = justPlayed;
    const mine = ++this.generation;

    // Only when there is nothing to show yet. A list that blanks itself every time it is opened
    // reads as a page reloading, which is the thing this app exists not to do.
    if (!this.opts.list.childElementCount) {
      this.opts.empty.hidden = false;
      this.opts.empty.textContent = 'Loading the board…';
    }

    const each = this.each;
    const result = await this.opts.api.leaderboard('all', LIMIT[each], each);
    if (mine !== this.generation) return;

    if (!result.ok) {
      this.opts.list.replaceChildren();
      this.opts.empty.hidden = false;
      this.opts.empty.textContent = isUnreachable(result)
        ? 'The board is not reachable from here. The game still plays.'
        : `The board could not be loaded: ${apiMessage(result)}`;
      return;
    }

    this.opts.list.replaceChildren(...result.runs.map((run) => this.row(run)));
    this.opts.empty.hidden = result.runs.length > 0;
    this.opts.empty.textContent = 'Nobody has scored yet. Be the first.';
  }

  /** Mark the row whose run is on the board, or none. */
  setWatching(id: string | null): void {
    this.watching = id;
    for (const li of this.opts.list.querySelectorAll<HTMLElement>('li')) {
      const on = li.dataset['id'] === id;
      li.classList.toggle('is-watching', on);
      const meta = li.querySelector('.meta');
      if (meta) meta.textContent = on ? `Watching · ${li.dataset['meta']}` : (li.dataset['meta'] ?? '');
    }
  }

  private row(run: BoardRun): HTMLElement {
    const li = document.createElement('li');
    li.dataset['id'] = run.id;
    if (run.id === this.justPlayed) li.classList.add('is-fresh');
    if (this.opts.api.account && run.player === this.opts.api.account.displayName) {
      li.classList.add('is-mine');
    }

    const seconds = (run.ticks * TICK_MS) / 1000;
    const when = run.startedAt || run.verifiedAt;
    const facts = [
      `${run.lines} ${run.lines === 1 ? 'line' : 'lines'}`,
      `level ${run.level}`,
      formatDuration(seconds),
      when ? new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
      run.over ? '' : 'unfinished',
    ]
      .filter(Boolean)
      .join(' · ');
    li.dataset['meta'] = facts;

    const who = span('who', '');
    const name = span('player', run.player);
    name.title = run.player;
    who.append(name, span('meta num', facts));

    const watch = document.createElement('button');
    watch.type = 'button';
    watch.className = 'icon-btn';
    watch.append(icon('play'));
    const label = `Watch ${run.player}'s ${run.score.toLocaleString()}`;
    watch.setAttribute('aria-label', label);
    watch.title = label;
    watch.addEventListener('click', () => this.opts.onWatch(run));

    li.append(span('rank num', String(run.rank)), who, span('score num', run.score.toLocaleString()), watch);
    if (run.id === this.watching) li.classList.add('is-watching');
    return li;
  }
}

/** The short list on the Play panel: rank, name and score, nothing to press. */
export function renderTopRuns(list: HTMLElement, runs: readonly BoardRun[]): void {
  list.replaceChildren(
    ...runs.map((run) => {
      const li = document.createElement('li');
      li.append(span('rank num', String(run.rank)), span('player', run.player), span('score num', run.score.toLocaleString()));
      return li;
    }),
  );
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}
