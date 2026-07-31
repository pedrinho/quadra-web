/*
 * Sound events emitted by the simulation.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The original calls `Sample::play` straight from the gameplay code, picking the landing
 * variant and every pitch/volume wobble from `ugs_random` — the global, non-deterministic
 * RNG, deliberately never `canvas->rnd`, the seeded game LCG (source/player.cc:144, :762,
 * :1564).
 *
 * That separation is load-bearing, so this port makes it structural: the engine only
 * records *what happened*, with parameters it already knows for certain, and the audio
 * layer decides how it sounds. Nothing here reads a random number or touches an
 * AudioContext, so the simulation stays pure, deterministic and headless-testable.
 */

export type SoundEvent =
  /** A rotation succeeded. `column` is the piece's `bx`, which the original pans by. */
  | { kind: 'rotate'; column: number }
  /** A piece was stamped into the board. One of three samples is chosen downstream. */
  | { kind: 'land'; column: number }
  /** Rows were cleared. `chain` is `canvas.complexity`, already incremented. */
  | { kind: 'lineClear'; chain: number }
  /** A rigid-body fall came to rest. Louder the further it fell. */
  | { kind: 'cascadeSettled'; chain: number; rowsFallen: number }
  | { kind: 'levelUp' }
  | { kind: 'gameOver' };
