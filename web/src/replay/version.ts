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

/**
 * A digest of every source file under `src/engine/`, checked by `test/engine-version.test.ts`.
 *
 * It exists because `SIM_VERSION` above is a promise a person has to remember to keep, and the
 * cost of forgetting is silent: recordings keep verifying and quietly stop meaning what they
 * said. Changing the engine at all breaks this test, which forces the question — *can this
 * change the outcome of a game?* — to be answered out loud rather than skipped.
 *
 * When it fails: if the change can alter a game (piece tables, collision, the cascade, scoring,
 * DAS, the input gate, the RNG), bump `SIM_VERSION` too and decide what happens to stored
 * tapes. If it cannot (a comment, a rename, a type), leave `SIM_VERSION` alone. Either way,
 * paste the digest the test prints in here.
 */
export const SIM_SOURCE_HASH = '208e21cb265fa324';
