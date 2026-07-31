/*
 * Port of Canvas::give_line scoring and levelling — source/canvas.cc:477-648 in Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import type { Canvas } from './canvas.js';

/**
 * Score awarded for a completed move, before the level multiplier.
 * Exposed separately so tests can check the curve without running a game.
 */
export function baseScore(depth: number, complexity: number, clean: boolean): number {
  let score: number;
  switch (depth) {
    case 1:
      score = 250;
      break;
    case 2:
      score = 500;
      break;
    case 3:
      score = 1000;
      break;
    case 4:
      score = 2000;
      break;
    default:
      score = 200 * depth * depth;
      break;
  }

  // The cascade bonus. Quadratic in the number of chain iterations, which is what makes
  // setting up a long cascade worth far more than clearing the same lines flat.
  score += 200 * (complexity - 1) * (complexity - 1);

  if (clean) score += depth <= 4 ? depth * 1250 : depth * depth * 500;

  return score;
}

/** Lines needed to reach the next level. Cumulative — linesCur is never reset. */
export function levelThreshold(level: number): number {
  return level * 15;
}

/**
 * `Canvas::give_line` — applies the score and level-up for a finished move, then resets the
 * per-move accumulators.
 *
 * Attack generation is deliberately omitted here; it belongs with multiplayer.
 */
export function giveLine(canvas: Canvas, levelUpEnabled: boolean): number {
  if (!canvas.depth) return 0;

  let scoreAdd = baseScore(canvas.depth, canvas.complexity, canvas.sendForClean);
  // +10% per level, integer division as in C++.
  scoreAdd += ((scoreAdd / 10) | 0) * canvas.level;

  canvas.score += scoreAdd;
  canvas.linesCur += canvas.depth;
  canvas.linesTot += canvas.depth;

  if (levelUpEnabled && canvas.linesCur >= levelThreshold(canvas.level)) {
    canvas.level++;
    canvas.calcSpeed();
  }

  canvas.depth = 0;
  canvas.complexity = 0;
  canvas.sendForClean = false;

  return scoreAdd;
}
