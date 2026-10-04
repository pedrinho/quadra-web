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
import { apiMessage, isUnreachable, type Api, type BoardEach, type BoardRun } from '../api.js';
import { formatDuration } from './format.js';

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
  /** Bumped per refresh, so a slow response for an old request cannot overwrite a newer board. */
  private generation = 0;

  constructor(private readonly opts: RecordsOptions) {}

  async refresh(justPlayed: string | null = this.justPlayed): Promise<void> {
    this.justPlayed = justPlayed;
    const mine = ++this.generation;

    this.opts.empty.hidden = false;
    this.opts.empty.textContent = 'Loading the board…';

    const { each } = this.opts;
    const result = await this.opts.api.leaderboard('all', LIMIT[each], each);
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

    const player = span('player', run.player);
    player.title = run.player;
    if (!run.over) player.append(span('tag', 'unfinished'));

    // The facts are a box of their own so that a phone can lay them out as one line under the
    // name, but on a wide screen it dissolves (`display: contents`) and each fact takes its own
    // column under the header. The units are in the text for a screen reader and for the phone,
    // and hidden where the header already says them.
    const facts = document.createElement('span');
    facts.className = 'facts';
    const seconds = (run.ticks * TICK_MS) / 1000;
    const when = run.startedAt || run.verifiedAt;
    facts.append(
      measure(String(run.lines), run.lines === 1 ? ' line' : ' lines'),
      measure(String(run.level), 'Level ', true),
      measure(formatDuration(seconds), ''),
      span(
        'when',
        when ? new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
      ),
    );

    // A cell of its own for one button, so the grid can hold it against the right edge.
    const actions = document.createElement('span');
    actions.className = 'row-actions';
    actions.append(button('Watch', () => this.opts.onWatch(run)));

    li.append(span('rank', String(run.rank)), player, span('score num', run.score.toLocaleString()), facts, actions);
    return li;
  }
}

/** A number in its column, with its unit in the text but shown only where no header says it. */
function measure(value: string, unit: string, before = false): HTMLElement {
  const el = span('num', '');
  const u = span('unit', unit);
  if (before) el.append(u, value);
  else el.append(value, u);
  return el;
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
  el.className = 'btn btn-secondary btn-small';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}
