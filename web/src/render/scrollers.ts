/*
 * The text that rises up the well when a move scores.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Port of `Player_text_scroll` (source/player.cc:597-629) and the `Zone_combo` it owns
 * (source/zone.cc:115-132). One line of text, spawned 30 px above the bottom of the well,
 * moving up two pixels every 10 ms tick and gone the moment it passes the top — about a
 * second and two thirds of travel.
 *
 * It lives out here rather than in `src/engine/` because that is where it lives in the
 * original too: the scroller is only spawned `if(inter && !small_watch)`, so a board nobody
 * is watching never makes one, and nothing about a game depends on whether it did. The engine
 * says what happened (see engine/notices.ts) and this decides what that looks like.
 */

import type { Framebuffer } from './framebuffer.js';
import { Font, type Fontdata } from './font.js';
import { BOARD_X, BOARD_Y } from './board-view.js';
import type { Notice } from '../engine/notices.js';

/**
 * A source of notices to show. Structurally a `Game`, but written out so this file does not
 * have to depend on the engine's entry point to draw a line of text.
 */
export interface NoticeSource {
  /** Ticks simulated so far. The scroller moves on the simulation's clock, not the display's. */
  readonly ticks: number;
  drainNotices(): Notice[];
}

/* Geometry, from `Player_text_scroll`'s constructor. `canvas->x`/`canvas->y` are the top-left
 * of the well, which is BOARD_X/BOARD_Y here. */

/** `canvas->y + 330`: 30 px up from the bottom of the 360 px well. */
const START_Y = BOARD_Y + 330;
/** `give_line` passes xoffset=20 for the score popup (source/canvas.cc:626). */
const SCORE_X = BOARD_X + 20;
/** `check_clean` takes the default xoffset=4 (source/canvas.h:147). */
const CLEAN_X = BOARD_X + 4;
/** `combo->y -= 2` per step, and the step runs once per 10 ms tick. */
const RISE = 2;

interface Scroller {
  text: string;
  x: number;
  y: number;
}

/**
 * The English string table, verbatim from `textes/anglais.txt` — entries 127-130 and 376,
 * reached through ST_CLEARDOUBLE..ST_CLEARMORE and ST_CLEANCANVAS.
 *
 * `%i-lines!` takes the depth first and the score second, which is the one place in this set
 * where the order is not obvious.
 */
function textOf(notice: Notice): string {
  if (notice.kind === 'clean') return 'Clean Canvas!!';
  switch (notice.depth) {
    case 2:
      return `Double! ${notice.score} pts`;
    case 3:
      return `Triple! ${notice.score} pts`;
    case 4:
      return `Quad! ${notice.score} pts`;
    default:
      return `${notice.depth}-lines! ${notice.score} pts`;
  }
}

/** Where a notice starts out. The two messages are inset differently, as they are upstream. */
function startX(notice: Notice): number {
  return notice.kind === 'clean' ? CLEAN_X : SCORE_X;
}

export class TextScrollers {
  private items: Scroller[] = [];
  /** The game being followed, so that switching to another one starts with an empty well. */
  private source: NoticeSource | null = null;
  private ticks = 0;
  private font: Font | null = null;

  constructor(private readonly data: Fontdata) {}

  /**
   * Advance what is already rising, then take whatever the game has queued since last time.
   *
   * Driven by the simulation's tick count rather than by elapsed wall time, so the text rises
   * at the rate the original moves it — and a replay watched at half speed shows it rising at
   * half speed, because that is what the game underneath is doing.
   */
  follow(source: NoticeSource): void {
    // A different game, or the same one wound back: none of what is on screen belongs to it.
    // `TapePlayer.seek` rebuilds the game from the header and re-simulates up to the frame
    // asked for, so both a new game and a scrub look like this.
    if (source !== this.source || source.ticks < this.ticks) {
      this.items = [];
      this.source = source;
      this.ticks = source.ticks;
      // Everything that happened on the way to this frame happened off screen. Showing it
      // would stack a whole run's worth of text on one spot the moment a viewer scrubs.
      source.drainNotices();
      return;
    }

    const elapsed = source.ticks - this.ticks;
    this.ticks = source.ticks;
    if (elapsed) {
      for (const item of this.items) item.y -= RISE * elapsed;
      // `if(combo->y < canvas->y) stop()` — it is still drawn on the tick it reaches the top.
      this.items = this.items.filter((item) => item.y >= BOARD_Y);
    }

    // After the advance: these were spawned during the ticks just run, so their first step is
    // the next one.
    for (const notice of source.drainNotices()) {
      this.items.push({ text: textOf(notice), x: startX(notice), y: START_Y });
    }
  }

  /** Drop everything on screen without touching the game — for a board being taken away. */
  clear(): void {
    this.items = [];
    this.source = null;
  }

  /**
   * Throw the built face away. A `Font` resolves its glyph intensities against one palette
   * when it is built, so whoever swaps the palette — a level change, a different screen — has
   * to say so. Rebuilt lazily, on the next line of text there actually is to draw.
   */
  invalidateFont(): void {
    this.font = null;
  }

  /** Draw the lot, left-aligned as `Zone_text` does with `lock_size` off (source/inter.cc:262). */
  draw(fb: Framebuffer): void {
    if (!this.items.length) return;
    // Plain white, as the in-game screen sets it up (source/multi_player.cc:70). The ramp
    // down to black that `Font` builds is what keeps it legible over the photograph.
    if (!this.font) this.font = new Font(this.data, fb.palette, [255, 255, 255]);
    for (const item of this.items) this.font.draw(fb, item.text, item.x, item.y);
  }

  /** What is on screen right now. For tests, and for anything that wants to know. */
  get live(): readonly Readonly<Scroller>[] {
    return this.items;
  }
}
