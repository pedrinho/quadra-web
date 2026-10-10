/*
 * The museum: Quadra's first ten years, and what survives of them.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Built the first time it is opened and kept after that, so leaving and coming back finds it
 * where it was, scrolled to the same place. Everything it says is in museum/content.ts and
 * museum/recordings.ts; this only lays it out.
 *
 * The 1998 art is shown here as itself — whole screens, framed, at their own size — which is the
 * one place on the site it appears outside the board.
 */

import {
  CLANS,
  CURATOR_NOTE,
  CURIOSITIES,
  MAKERS,
  PLAYERS,
  TIMELINE,
  type Moment,
  type Person,
  type Source,
} from '../museum/content.js';
import { RECORDINGS, canPlay, findRecording, recordingUrl, type MuseumRecording } from '../museum/recordings.js';
import list2000 from '../museum/2000-03-08-ludusdesign-highscores.csv?raw';
import list2009 from '../museum/2009-05-06-qserv-top100.csv?raw';
import { formatDuration } from './format.js';
import { icon } from './icons.js';

export interface MuseumOptions {
  host: HTMLElement;
  onWatch: (rec: MuseumRecording) => void;
  /** Open a `.rec` from the visitor's own disk, the way the leaderboard's control does. */
  onOpenFile: (file: File) => void;
}

interface Room {
  id: string;
  title: string;
  build: () => HTMLElement[];
}

/* --- small DOM helpers ------------------------------------------------------- */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

const n = (value: number): string => value.toLocaleString('en-US');

function sourceLink(source: Source): HTMLAnchorElement {
  return h('a', { href: source.href, rel: 'noreferrer', class: 'src' }, source.label);
}

/**
 * A screen, framed, at its own size. `width` is the source's, so a 640x480 capture is drawn at
 * 640 CSS pixels: one source pixel to one CSS pixel, or to a whole number of device pixels.
 */
function exhibit(src: string, alt: string, caption: Child[], width = 640, height = 480): HTMLElement {
  return h(
    'figure',
    { class: 'exhibit' },
    h(
      'div',
      { class: 'mat' },
      h('img', { src, alt, width: String(width), height: String(height), loading: 'lazy', decoding: 'async' }),
    ),
    h('figcaption', null, ...caption),
  );
}

/* --- the high-score lists -------------------------------------------------- */

interface ScoreRow {
  rank: number;
  name: string;
  score: number;
  lines: number;
  level: number;
  date?: string;
}

/** The two CSVs are ours and plain, but a name could carry a comma, so quoted fields are honoured. */
function parseCsv(text: string): ScoreRow[] {
  const rows: string[][] = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        cells.push(cell);
        cell = '';
      } else cell += c;
    }
    cells.push(cell);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  const at = (name: string) => head!.indexOf(name);
  return body.map((r) => ({
    rank: Number(r[at('position')]),
    name: r[at('name')]!,
    score: Number(r[at('score')]),
    lines: Number(r[at('lines')]),
    level: Number(r[at('level')]),
    ...(at('date') >= 0 ? { date: r[at('date')]!.slice(0, 10) } : {}),
  }));
}

const LISTS = {
  '2000': { title: 'March 2000', rows: parseCsv(list2000) },
  '2009': { title: 'May 2009', rows: parseCsv(list2009) },
} as const;
type ListKey = keyof typeof LISTS;

/** Rows on the lists whose recording is in the archive. */
const RECORDED: Partial<Record<ListKey, Record<number, string>>> = {
  '2009': { 43: 'pedrinhu-854975', 33: 'issue11-local0' },
};

const SVG = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * Score by place, both lists on one axis: the line for 2009 sits above the line for 2000 the
 * whole way down. Hovering a place shows who held it in each.
 */
function scoreChart(): HTMLElement {
  const W = 640;
  const H = 240;
  const pad = { l: 44, r: 92, t: 12, b: 28 };
  const max = 3_000_000;
  const x = (rank: number) => pad.l + ((rank - 1) / 99) * (W - pad.l - pad.r);
  const y = (score: number) => pad.t + (1 - score / max) * (H - pad.t - pad.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img' });
  svg.setAttribute(
    'aria-label',
    'World high score by place. March 2000: 783,549 at first place, 235,962 at hundredth. ' +
      'May 2009: 2,951,441 at first, 646,360 at hundredth.',
  );
  for (const v of [0, 1_000_000, 2_000_000, 3_000_000]) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
    const label = s('text', { x: pad.l - 8, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = v === 0 ? '0' : `${v / 1_000_000}M`;
    svg.append(label);
  }
  for (const r of [1, 25, 50, 75, 100]) {
    const label = s('text', { x: x(r), y: H - 8, class: 'tick', 'text-anchor': 'middle' });
    label.textContent = String(r);
    svg.append(label);
  }

  for (const key of ['2000', '2009'] as const) {
    const rows = LISTS[key].rows;
    const d = rows.map((row, i) => `${i ? 'L' : 'M'}${x(row.rank).toFixed(1)} ${y(row.score).toFixed(1)}`).join('');
    svg.append(s('path', { d, class: `series s${key}` }));
    const last = rows[rows.length - 1]!;
    const end = s('text', { x: W - pad.r + 10, y: y(last.score) + 4, class: 'end-label' });
    end.textContent = LISTS[key].title;
    svg.append(end);
  }

  const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
  const dots = (['2000', '2009'] as const).map((key) => {
    const dot = s('circle', { r: 4, class: `dot s${key}`, visibility: 'hidden' });
    svg.append(dot);
    return dot;
  });
  svg.insertBefore(cross, dots[0]!);
  const hit = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, class: 'hit' });
  svg.append(hit);

  const tip = h('div', { class: 'chart-tip', hidden: '' });
  const wrap = h('div', { class: 'chart' }, svg, tip);

  const show = (clientX: number): void => {
    const box = svg.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * W;
    const rank = Math.min(100, Math.max(1, Math.round(((sx - pad.l) / (W - pad.l - pad.r)) * 99 + 1)));
    const a = LISTS['2000'].rows[rank - 1]!;
    const b = LISTS['2009'].rows[rank - 1]!;
    cross.setAttribute('x1', String(x(rank)));
    cross.setAttribute('x2', String(x(rank)));
    cross.setAttribute('visibility', 'visible');
    dots[0]!.setAttribute('cx', String(x(rank)));
    dots[0]!.setAttribute('cy', String(y(a.score)));
    dots[1]!.setAttribute('cx', String(x(rank)));
    dots[1]!.setAttribute('cy', String(y(b.score)));
    for (const dot of dots) dot.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      h('b', null, `Number ${rank}`),
      h('span', { class: 'k s2009' }, `${b.name}, ${n(b.score)}`),
      h('span', { class: 'k s2000' }, `${a.name}, ${n(a.score)}`),
    );
    tip.hidden = false;
    const left = (x(rank) / W) * box.width;
    tip.style.left = `${Math.min(left + 12, box.width - 220)}px`;
  };
  const hide = (): void => {
    cross.setAttribute('visibility', 'hidden');
    for (const dot of dots) dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);

  const legend = h(
    'div',
    { class: 'chart-legend' },
    h('span', { class: 'k s2009' }, 'May 2009'),
    h('span', { class: 'k s2000' }, 'March 2000'),
  );
  return h('div', null, legend, wrap);
}

/* --- the museum ------------------------------------------------------------ */

export class Museum {
  private built = false;
  private readonly scroller: HTMLElement;
  private readonly index: HTMLElement;
  private readonly body: HTMLElement;
  private readonly rooms: Room[];
  /** Where the visitor was when the museum was put away, so coming back finds the same place. */
  private parked: { top: number; focus: HTMLElement | null } | null = null;

  constructor(private readonly opts: MuseumOptions) {
    this.index = h('nav', { class: 'museum-index', 'aria-label': 'Rooms' });
    this.body = h('div', { class: 'museum-body' });
    this.scroller = h('div', { class: 'museum-scroll' }, h('div', { class: 'museum-inner' }, this.index, this.body));
    opts.host.append(this.scroller);

    this.rooms = [
      { id: 'opening', title: 'Museum', build: () => this.opening() },
      { id: 'timeline', title: 'Timeline', build: () => this.timeline() },
      { id: 'people', title: 'People and clans', build: () => this.people() },
      { id: 'scores', title: 'World high scores', build: () => this.scores() },
      { id: 'recordings', title: 'Recordings', build: () => this.recordings() },
      { id: 'pictures', title: 'Pictures', build: () => this.pictures() },
      { id: 'assets', title: 'From the game’s files', build: () => this.assets() },
      { id: 'curiosities', title: 'Curiosities', build: () => this.curiosities() },
      { id: 'sources', title: 'Sources', build: () => this.sources() },
    ];
  }

  /** Build on first sight. Cheap after that: the rooms stay in the document. */
  show(): void {
    if (this.built) return;
    this.built = true;
    for (const room of this.rooms) {
      const section = h('section', { class: 'room', id: `museum-${room.id}`, 'aria-labelledby': `museum-${room.id}-title` });
      const heading = room.id === 'opening' ? 'h1' : 'h2';
      const title = h(heading, { id: `museum-${room.id}-title`, class: 'room-title', tabindex: '-1' }, room.title);
      section.append(title, ...room.build());
      this.body.append(section);

      const link = h('a', { href: `#museum-${room.id}`, 'data-room': room.id }, room.title);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.open(room.id);
      });
      this.index.append(link);
    }
    this.watchScroll();
  }

  /** Go to a room. */
  open(id: string): void {
    const section = this.body.querySelector<HTMLElement>(`#museum-${id}`);
    if (!section) return;
    section.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    this.mark(id);
  }

  /**
   * About to be hidden. A hidden element forgets how far it was scrolled, so remember that, and
   * which control was in use, for `unpark`.
   */
  park(): void {
    const active = document.activeElement;
    this.parked = {
      top: this.scroller.scrollTop,
      focus: active instanceof HTMLElement && this.opts.host.contains(active) ? active : null,
    };
  }

  /** Shown again: back to the same place. Returns whether there was a place to go back to. */
  unpark(): boolean {
    const parked = this.parked;
    if (!parked) return false;
    this.parked = null;
    this.scroller.scrollTop = parked.top;
    (parked.focus ?? this.heading)?.focus({ preventScroll: true });
    return true;
  }

  /** The heading that should take focus when the view is entered. */
  get heading(): HTMLElement | null {
    return this.opts.host.querySelector('h1');
  }

  private mark(id: string): void {
    for (const a of this.index.querySelectorAll<HTMLElement>('a[data-room]')) {
      if (a.dataset['room'] === id) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  }

  /** Light the index entry for the room being read. */
  private watchScroll(): void {
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) this.mark(top.target.id.replace('museum-', ''));
      },
      { root: this.scroller, rootMargin: '0px 0px -70% 0px' },
    );
    for (const room of this.body.querySelectorAll('.room')) observer.observe(room);
    this.mark('opening');
  }

  /* --- rooms --------------------------------------------------------------- */

  private opening(): HTMLElement[] {
    return [
      h(
        'p',
        { class: 'room-lede' },
        'Quadra was made in 1998 and 1999 by five friends who called themselves Ludus Design. ' +
          'This is what is left of its first ten years: the company’s own words, the world lists, ' +
          'the clans, and the recordings people kept.',
      ),
      exhibit('/museum/shots/ludus-1999-1.jpg', 'A four-player Quadra game with the French interface: Dada, Rem, Seventh, Dilu and FortS in the scoreboard, and the chat full of frags.', [
        h('b', null, 'Dada, Rem, Seventh, Dilu and FortS, 1999. '),
        'One of three screenshots on Ludus Design’s site: the developers playing each other, in French. ',
        h('span', { class: 'quiet' }, '“Dada: hahaha :)” — “Rem: ouch”'),
      ]),
      h(
        'aside',
        { class: 'curator' },
        h('h3', null, 'A note from the curator'),
        ...CURATOR_NOTE.map((p) => h('p', null, p)),
        h('p', { class: 'sig' }, 'Pedro, pedrinhu'),
      ),
    ];
  }

  private timeline(): HTMLElement[] {
    const years = new Map<string, Moment[]>();
    for (const m of TIMELINE) {
      const y = m.when.slice(0, 4);
      years.set(y, [...(years.get(y) ?? []), m]);
    }
    const list = h('ol', { class: 'timeline' });
    for (const [year, moments] of years) {
      const items = h('ol', { class: 'moments' });
      for (const m of moments) {
        const rec = m.recording ? findRecording(m.recording) : undefined;
        items.append(
          h(
            'li',
            null,
            h('time', { datetime: m.when }, m.when),
            h('h3', null, m.title),
            h('p', null, m.text),
            m.quote &&
              h('blockquote', null, h('p', null, `“${m.quote.text}”`), h('footer', null, m.quote.by)),
            h('p', { class: 'cite' }, sourceLink(m.source), rec && this.recLink(rec)),
          ),
        );
      }
      list.append(h('li', { class: 'year' }, h('span', { class: 'year-num', 'aria-hidden': 'true' }, year), h('div', null, h('h3', { class: 'vh' }, year), items)));
    }
    return [list];
  }

  /** "Watch" for a recording that plays, "Recording" for one that only downloads. */
  private recLink(rec: MuseumRecording): HTMLElement {
    if (canPlay(rec)) {
      const b = h('button', { type: 'button', class: 'link' }, 'Watch it');
      b.addEventListener('click', () => this.opts.onWatch(rec));
      return b;
    }
    const a = h('a', { href: `#museum-rec-${rec.id}`, class: 'link' }, 'The recording');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      this.open('recordings');
      this.body.querySelector(`#museum-rec-${rec.id}`)?.scrollIntoView({ block: 'center' });
    });
    return a;
  }

  private people(): HTMLElement[] {
    const card = (p: Person) =>
      h(
        'li',
        null,
        h('h4', null, p.name, p.also && h('span', { class: 'also' }, p.also)),
        h('p', { class: 'role' }, p.role),
        h('p', null, p.text),
        h('p', { class: 'cite' }, sourceLink(p.source)),
      );
    const clans = h('ul', { class: 'clans' });
    for (const c of CLANS) {
      clans.append(
        h(
          'li',
          null,
          h('span', { class: 'tag' }, c.tag),
          h(
            'div',
            null,
            h('h4', null, c.name ?? c.tag),
            h(
              'p',
              { class: 'role' },
              c.places ? `${c.places} places in the 2009 top 100. Best: ${c.best}.` : `Best in 2009: ${c.best}.`,
            ),
            h('p', null, c.text),
            c.source && h('p', { class: 'cite' }, sourceLink(c.source)),
          ),
        ),
      );
    }
    return [
      h('h3', { class: 'sub' }, 'The company'),
      h('ul', { class: 'people' }, ...MAKERS.map(card)),
      exhibit('/museum/shots/ludus-1999-2.jpg', 'A Quadra game being watched: four small boards for Dada, Franky, Norm and Rem#2, and the chat in French.', [
        h('b', null, 'Dada, Franky, Norm and Rem#2, 1999. '),
        'Another of Ludus Design’s screenshots. Franky and Norm were beta testers.',
      ]),
      h('h3', { class: 'sub' }, 'Players'),
      h('ul', { class: 'people' }, ...PLAYERS.map(card)),
      h('h3', { class: 'sub' }, 'Clans'),
      h(
        'p',
        { class: 'room-lede' },
        'Players wore their clan’s tag in their name. The tags are what the world list kept.',
      ),
      clans,
    ];
  }

  private scores(): HTMLElement[] {
    const table = h('div', { class: 'scores-table' });
    const tabs = h('div', { role: 'tablist', 'aria-label': 'Which list' });
    const pick = (key: ListKey): void => {
      for (const t of tabs.querySelectorAll<HTMLElement>('[role=tab]')) {
        t.setAttribute('aria-selected', String(t.dataset['list'] === key));
      }
      table.replaceChildren(this.scoreTable(key));
    };
    for (const key of ['2000', '2009'] as const) {
      const t = h('button', { type: 'button', role: 'tab', 'data-list': key }, LISTS[key].title);
      t.addEventListener('click', () => pick(key));
      tabs.append(t);
    }
    pick('2000');

    return [
      h(
        'p',
        { class: 'room-lede' },
        'Every single-player game could be sent to Ludus Design’s server with its recording. Two ' +
          'of its top-hundred tables were archived, nine years apart. No name is on both.',
      ),
      h(
        'dl',
        { class: 'figures' },
        h('div', null, h('dt', null, 'Number 1, March 2000'), h('dd', null, '783,549'), h('dd', { class: 'who' }, 'Norm')),
        h('div', null, h('dt', null, 'Number 1, May 2009'), h('dd', null, '2,951,441'), h('dd', { class: 'who' }, 'RZ***Stephen')),
        h('div', null, h('dt', null, 'Number 100, May 2009'), h('dd', null, '646,360'), h('dd', { class: 'who' }, 'Siw')),
      ),
      scoreChart(),
      h(
        'p',
        { class: 'note' },
        'Norm’s 783,549, number 1 in 2000, would have been number 55 in 2009. pedrinhu’s 854,975, ' +
          'number 43 in 2009, would have topped the 2000 list.',
      ),
      tabs,
      table,
    ];
  }

  private scoreTable(key: ListKey): HTMLElement {
    const list = LISTS[key];
    const dated = key === '2000';
    const head = h(
      'tr',
      null,
      h('th', { scope: 'col', class: 'r' }, 'Place'),
      h('th', { scope: 'col' }, 'Name'),
      h('th', { scope: 'col', class: 'r' }, 'Score'),
      h('th', { scope: 'col', class: 'r' }, 'Lines'),
      h('th', { scope: 'col', class: 'r' }, 'Level'),
      dated ? h('th', { scope: 'col', class: 'r' }, 'Played') : h('th', { scope: 'col' }, ''),
    );
    const body = h('tbody');
    for (const row of list.rows) {
      const recId = RECORDED[key]?.[row.rank];
      const rec = recId ? findRecording(recId) : undefined;
      body.append(
        h(
          'tr',
          rec ? { class: 'has-rec' } : null,
          h('td', { class: 'r num' }, String(row.rank)),
          h('td', null, row.name),
          h('td', { class: 'r num' }, n(row.score)),
          h('td', { class: 'r num' }, String(row.lines)),
          h('td', { class: 'r num' }, String(row.level)),
          dated ? h('td', { class: 'r num' }, row.date ?? '') : h('td', null, rec ? this.recLink(rec) : null),
        ),
      );
    }
    const note =
      key === '2009'
        ? 'Every date on this list reads 1969-12-31: the server never kept one. Two of these runs survive as recordings.'
        : 'The oldest score here was played three days after Quadra came out.';
    return h(
      'div',
      null,
      h('p', { class: 'note' }, note),
      h('table', null, h('caption', { class: 'vh' }, `World top 100, ${list.title}`), h('thead', null, head), body),
    );
  }

  private recordings(): HTMLElement[] {
    const items = h('ol', { class: 'recs' });
    for (const rec of RECORDINGS) {
      const players = h('ul', { class: 'rec-players' });
      for (const p of rec.players) {
        players.append(h('li', null, h('span', null, p.name), h('span', { class: 'num' }, n(p.score))));
      }
      const actions = h('div', { class: 'rec-actions' });
      if (canPlay(rec)) {
        const watch = h('button', { type: 'button', class: 'btn btn-primary btn-small' }, icon('play'), 'Watch');
        watch.addEventListener('click', () => this.opts.onWatch(rec));
        actions.append(watch);
      } else {
        actions.append(h('span', { class: 'later' }, 'Plays here when multiplayer arrives'));
      }
      actions.append(h('a', { class: 'btn btn-ghost btn-small', href: recordingUrl(rec), download: rec.file }, 'Download'));

      items.append(
        h(
          'li',
          { id: `museum-rec-${rec.id}`, class: canPlay(rec) ? 'rec plays' : 'rec' },
          h(
            'div',
            { class: 'rec-head' },
            h('h3', null, rec.title),
            h('p', { class: 'rec-when' }, h('time', { datetime: rec.played }, rec.played), h('span', null, formatDuration(rec.duration / 100))),
          ),
          players,
          rec.note && h('p', { class: 'rec-note' }, rec.note),
          h(
            'p',
            { class: 'rec-meta' },
            h('span', { class: 'file' }, rec.file),
            ` Quadra ${rec.quadra}, rules version ${rec.protocol}.`,
            rec.server ? ` Server “${rec.server}”.` : '',
            ` ${rec.source}.`,
          ),
          actions,
        ),
      );
    }

    const file = h('input', { type: 'file', accept: '.rec,.qrec', class: 'vh', id: 'museum-rec-file' });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) this.opts.onOpenFile(f);
    });

    return [
      h(
        'p',
        { class: 'room-lede' },
        'A recording is a seed and the keys that were pressed, so a game can be played again ' +
          'rather than watched as a film. The older single-player kind plays on this site’s board ' +
          'now. The rest were written as network traffic and will play once this port has ' +
          'multiplayer.',
      ),
      items,
      h(
        'div',
        { class: 'rec-more' },
        h('h3', null, 'Have one?'),
        h(
          'p',
          null,
          'The world high-score server kept a recording of every run sent to it, and it is gone. ' +
            'The game saved the world’s top runs it downloaded as files named global0, global1 and so ' +
            'on, and a player’s own best as local0. Old hard drives are the only place left to look.',
        ),
        h(
          'p',
          { class: 'rec-more-actions' },
          file,
          h('label', { for: 'museum-rec-file', class: 'btn btn-ghost btn-small' }, 'Open a .rec from your disk'),
          h('a', { class: 'btn btn-ghost btn-small', href: 'https://github.com/pedrinho/quadra-web/issues', rel: 'noreferrer' }, 'Send one to the museum'),
        ),
      ),
    ];
  }

  private pictures(): HTMLElement[] {
    return [
      h(
        'p',
        { class: 'room-lede' },
        'Quadra 1.3.0, built from its source in 2026, replaying recordings from this archive. ' +
          'Each picture is a frame exactly as the game drew it, at 640 by 480.',
      ),
      exhibit('/museum/shots/pedrinhu-level14.png', 'pedrinhu’s game at level 14: a six-line clear worth 19,680 points over a planet backdrop.', [
        h('b', null, 'pedrinhu, 29 October 2003. '),
        'Level 14, a six-line clear for 19,680. The counts on the right are every clear so far, by size.',
      ]),
      exhibit('/museum/shots/pedrinhu-level23.png', 'pedrinhu’s game at level 23, 849,152 points, a line flashing as it clears.', [
        h('b', null, 'The same game, level 23. '),
        'Less than six thousand points from the end: 849,152, with 341 lines.',
      ]),
      exhibit('/museum/shots/zap-level31.png', '[qz]-Zap-’s game at level 31, 981,128 points, the board nearly empty under a Level up! banner.', [
        h('b', null, '[qz]-Zap-, 18 March 2008. '),
        'Level 31 and nearly empty. One clear in this game was fifteen lines or more: the “More!” row.',
      ]),
      exhibit('/museum/shots/michvsn-8-7.png', 'Two small boards side by side, StepheN and [hf]michele, with the chat listing lines sent and frags.', [
        h('b', null, 'StepheN against [hf]michele, 11 February 2001. '),
        'Halfway: eight frags to seven, first to fifteen. Every “sends 6 lines” in the chat is an attack.',
      ]),
      exhibit('/museum/shots/show0376-eight.png', 'Eight players on the scoreboard and four of their boards being watched, RZ***Stephen leading with seven frags.', [
        h('b', null, 'Eight players on RZ***MediumPace, 9 October 2001. '),
        'A full server. “RZ***Stephen sends 12 lines.”',
      ]),
      exhibit('/museum/shots/demo03-results.png', 'The multiplayer results screen over a city at night: Rem and Norm’s team against Dada and Jeps.', [
        h('b', null, 'Multiplayer results, 16 September 1999. '),
        'The end of one of the demos that shipped with the game: Rem and Norm against Dada and Jeps.',
      ]),
      exhibit('/museum/shots/ludus-1999-0.jpg', 'A single-player game in French, level 18, 532,018 points, with dolphins behind the board.', [
        h('b', null, 'Ludus Design’s own screenshot, 1999. '),
        'A single-player game at level 18, in French: 265 lines, one of them an eleven-line clear.',
      ]),
    ];
  }

  private assets(): HTMLElement[] {
    const fonds = h('ul', { class: 'fonds' });
    for (let i = 0; i < 10; i++) {
      fonds.append(
        h(
          'li',
          null,
          h(
            'a',
            { href: `/museum/art/fond${i}.png`, target: '_blank', rel: 'noreferrer' },
            h('img', { src: `/museum/art/fond${i}.png`, alt: `Level ${i + 1} backdrop`, width: '320', height: '240', loading: 'lazy' }),
          ),
          h('span', null, `Level ${i + 1}`),
        ),
      );
    }

    const sounds = h('ul', { class: 'sounds' });
    const SOUNDS: [string, string][] = [
      ['hooter03', 'A new game starts'],
      ['pwap2', 'A line clears, on the first levels'],
      ['clang3', 'A cascade settles'],
      ['cuckoo', 'Pause'],
      ['potato_get', 'You get the hot potato'],
      ['t10sec', 'Ten seconds left, in a timed game'],
    ];
    for (const [file, what] of SOUNDS) {
      const audio = h('audio', { src: `/museum/sounds/${file}.wav`, preload: 'none' });
      const play = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Play ${file}.wav` }, icon('play'));
      play.addEventListener('click', () => {
        audio.currentTime = 0;
        void audio.play();
      });
      sounds.append(h('li', null, play, h('span', null, what), h('code', null, `${file}.wav`), audio));
    }

    return [
      h(
        'p',
        { class: 'room-lede' },
        'Quadra’s menus are pictures with the words painted in, one set per language. These are ' +
          'the files as they shipped, at their own size.',
      ),
      exhibit('/museum/art/debuto.png', 'The title screen: the word QUADRA in chrome letters over falling blocks, with the menu below and the Ludus Design logo.', [
        h('b', null, 'The title screen. '),
        '“Register” is painted into the picture, and stayed in the file after registration was removed in 1.1.7.',
      ]),
      exhibit('/museum/art/hscore.png', 'Fireworks, with “World highscores” and “Local highscores” painted above and below.', [
        h('b', null, 'High scores. '),
        'World above, local below. The French files say “Pointages mondiaux”.',
      ]),
      exhibit('/museum/art/setup.png', 'The player setup screen: name, password, shadow, smooth, speeds and the eight keys.', [
        h('b', null, 'Player setup. '),
        'Up to three players could share a computer, each with a name, a password and their own keys.',
      ]),
      h('h3', { class: 'sub' }, 'The ten levels'),
      h('p', null, 'Each level has a backdrop of its own and a set of sounds to go with it. They were unlocked by reaching them.'),
      fonds,
      h('h3', { class: 'sub' }, 'Sounds'),
      sounds,
      exhibit('/museum/art/debut8.png', 'The Ludus Design logo, in yellow light, with www.ludusdesign.com under it.', [h('b', null, 'Ludus Design. '), 'From the title screen.'], 221, 90),
    ];
  }

  private curiosities(): HTMLElement[] {
    return [
      h(
        'ul',
        { class: 'curios' },
        ...CURIOSITIES.map((c) => h('li', null, h('h3', null, c.title), h('p', null, c.text), h('p', { class: 'cite' }, c.cite))),
      ),
    ];
  }

  private sources(): HTMLElement[] {
    const links: Source[] = [
      { label: 'Ludus Design’s site, 1998–2000, in the Wayback Machine', href: 'http://web.archive.org/web/20001204192300/http://www.ludusdesign.com/' },
      { label: 'The world high scores, March 2000', href: 'http://web.archive.org/web/20000308142554/http://ludusdesign.com:80/highscores.shtml' },
      { label: 'The world top 100, May 2009', href: 'http://web.archive.org/web/20090506003422/http://ludusdesign.com:80/cgi-bin/qserv.pl?data=gethighscoreshtml%0Anum%20100' },
      { label: 'HELLFIRE’s site, mirrored by synt4x.org', href: 'https://synt4x.org/tgm/hellfire/' },
      { label: 'Why Quadra, by spindizzy', href: 'https://synt4x.org/tgm/hellfire/quadra/' },
      { label: 'The Quadra project on Google Code', href: 'https://code.google.com/archive/p/quadra/' },
      { label: 'Quadra 1.2.0, on LWN', href: 'https://lwn.net/Articles/336170' },
      { label: 'Quadra’s source', href: 'https://github.com/quadra-game/quadra' },
      { label: 'Every source, with dates', href: 'https://github.com/pedrinho/quadra-web/blob/main/museum/sources.md' },
    ];
    return [
      h('ul', { class: 'sources' }, ...links.map((l) => h('li', null, sourceLink(l)))),
      h(
        'p',
        { class: 'note' },
        'The words quoted here belong to the people who wrote them, and are linked to where they ' +
          'were published. Quadra, its art and its sounds are © 1998–2000 Ludus Design, free ' +
          'software under the GNU LGPL. Player names are as the public lists printed them.',
      ),
    ];
  }
}
