/*
 * Version stamps carried by every recording.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

/**
 * The simulation's behavioural version. **Bump this on any change that can alter the outcome
 * of a game** — piece tables, collision, the cascade, scoring, DAS, the input-sampling gate,
 * the RNG. A recording made under a different SIM_VERSION is refused rather than replayed,
 * because replaying it would silently produce a different score.
 *
 * Bumping it invalidates every stored recording. That is the point: the alternative is a
 * leaderboard whose entries quietly stop meaning what they said.
 */
export const SIM_VERSION = 1;

/** The container format. Bumped when the byte layout changes, independently of the sim. */
export const TAPE_FORMAT_VERSION = 1;
