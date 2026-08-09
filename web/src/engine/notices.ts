/*
 * On-screen notices emitted by the simulation.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The original raises these as UI objects from inside the gameplay code: `Canvas::give_line`
 * and `Player_check_line::check_clean` both call `Canvas::add_text_scroller`, which spawns a
 * module owning a text zone that drifts up the well (source/canvas.cc:374, :604-627 and
 * source/player.cc:585-595, :597-629). It is guarded by `if(inter && !small_watch)` — a board
 * nobody is looking at raises nothing — so even there the scroller is presentation, not play.
 *
 * This port keeps that structural, the same way sound-events.ts does: the engine records only
 * *what happened*, with the numbers it already knows for certain, and the render layer decides
 * where the text goes and how it moves. Nothing here is ever read back, so a host that shows
 * none of it plays an identical game.
 */

export type Notice =
  /**
   * A move was scored. `score` is the whole award — cascade, clean bonus and level multiplier
   * included — because `give_line` is the only moment it exists: it resets `depth`,
   * `complexity` and `sendForClean` on its way out.
   *
   * Only raised for `depth >= 2`. The original gates the popup on `i && enough`, where
   * `i = depth-1` and `enough` is `depth >= combo_min`, which is 2 in single player
   * (source/game.cc:211) — so a single-line clear says nothing at all.
   */
  | { kind: 'clear'; depth: number; score: number }
  /**
   * The playfield came up empty. Raised at the erase, as `check_clean` is, which is many
   * frames before the score for the same move: the flash and the fall run in between. So a
   * clean board shows two scrollers staggered in time rather than one line with both facts.
   */
  | { kind: 'clean' };
