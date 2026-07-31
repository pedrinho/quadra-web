/*
 * Repeat-speed tuning, derived from a 0-100% sensitivity instead of the original's four
 * named presets.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The original stores repeat speed as a dropdown index 0..3 — Slow / Normal / Fast / Faster
 * (source/menu.cc:1060-1069) — and turns it into a frame delay with a switch in
 * `Canvas::reinit` (source/canvas.cc:213-245).
 *
 * This port takes a percentage instead, mapped linearly onto the same delay range so all four
 * original settings stay exactly reachable:
 *
 *     delay = clamp(round(11 - pct / 10), 1, 11)
 *
 *       0%  ->  11 frames  = "Slow"
 *      50%  ->   6 frames  = "Normal"
 *      80%  ->   3 frames  = "Fast"    <- the default
 *     100%  ->   1 frame   = "Faster"
 *
 * Everything below that line is the original derivation verbatim, integer truncation and the
 * 180 clamp included. The delay stays an integer frame count because the DAS countdown in
 * player.ts is an integer counter that must keep matching source/player.cc:386-420.
 */

/** Slider positions matching the original's named settings. */
export const SENSITIVITY_PRESETS: ReadonlyArray<{ pct: number; label: string }> = [
  { pct: 0, label: 'Slow' },
  { pct: 50, label: 'Normal' },
  { pct: 80, label: 'Fast' },
  { pct: 100, label: 'Faster' },
];

/** The original's default, `h_repeat = v_repeat = 2` ("Fast") — source/cfgfile.cc:82-83. */
export const DEFAULT_SENSITIVITY = 80;

export const MIN_REPEAT_DELAY = 1;
export const MAX_REPEAT_DELAY = 11;

/** Repeat delay in 100 Hz frames for a 0-100% sensitivity. Out-of-range input is clamped. */
export function delayFromPercent(pct: number): number {
  if (!Number.isFinite(pct)) return delayFromPercent(DEFAULT_SENSITIVITY);
  const delay = Math.round(MAX_REPEAT_DELAY - pct / 10);
  if (delay < MIN_REPEAT_DELAY) return MIN_REPEAT_DELAY;
  if (delay > MAX_REPEAT_DELAY) return MAX_REPEAT_DELAY;
  return delay;
}

export interface RepeatTuning {
  /** Frames between horizontal repeats. The first repeat waits this plus 10. */
  hRepeatDelay: number;
  /** Cosmetic horizontal chase speed, 1/16-px per frame. */
  sideSpeed: number;
  /** Not a delay despite the name — it only exists to produce `downSpeed`. */
  vRepeatDelay: number;
  /** Soft-drop distance per sampled frame, 1/16-px. */
  downSpeed: number;
}

/** `Canvas::reinit` repeat derivation — source/canvas.cc:229-245. */
export function deriveRepeat(hPercent: number, vPercent: number): RepeatTuning {
  const hRepeatDelay = delayFromPercent(hPercent);
  const vRepeatDelay = delayFromPercent(vPercent);
  let downSpeed = (340 / vRepeatDelay) | 0;
  if (downSpeed > 180) downSpeed = 180;
  return {
    hRepeatDelay,
    sideSpeed: ((18 << 4) / hRepeatDelay) | 0,
    vRepeatDelay,
    downSpeed,
  };
}
