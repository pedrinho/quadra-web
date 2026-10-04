/*
 * The protocol version the rules are read at.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * `Game::net_version` (source/game.cc:595-600) looks like networking bookkeeping and is not: the
 * original gates real rules on it, because a rule change would otherwise desynchronise a game
 * against an older client. Below 23 the piece stream is drawn with a different generator
 * (source/player.cc:267-271), the cascade bonus is linear rather than quadratic and the clean
 * bonus is a flat 5000 paid at the erase (source/canvas.cc:513-527), and placing a piece quickly
 * is worth points of its own (source/player.cc:484-490).
 *
 * Everything this port plays and records is `CURRENT_NET_VERSION`. The only thing that ever asks
 * for less is a 1998 `.rec` demo, which `Playback` calls `old_mode` and plays at 20.
 *
 * Its own module because it is needed both at the top of the engine (`game.ts`) and at the
 * bottom (`rules.ts`), and a constant that has to be imported across a cycle is a constant that
 * will eventually be read in its temporal dead zone.
 */

/** What this port plays and records at. */
export const CURRENT_NET_VERSION = 23;

/**
 * The version at and above which the modern rules apply. Named rather than spelled `23` at each
 * of the four sites, so that grepping for the legacy paths finds all of them at once.
 */
export const MODERN_RULES_FROM = 23;

/** What a single-player `.rec` demo plays at — `old_mode` in source/recording.cc:244. */
export const OLD_MODE_NET_VERSION = 20;
