/*
 * Small formatting shared by whatever shows a run.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Its own module because the board and the replay viewer both want it, and neither should have to
 * import the other to say how long a run took.
 */

/** `m:ss`, the length of a run. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
