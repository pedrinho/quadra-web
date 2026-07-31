/*
 * The sound bank and the per-level sample themes.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The original keeps a flat struct of 28 `Sample*` slots (source/sons.h:26-31). Nineteen are
 * loaded once at startup (source/quadra.cc:245-274); the five gameplay samples are freed and
 * reloaded on every level change from a theme table in `Canvas::change_level`
 * (source/canvas.cc:704-771). Here the theme is just a lookup — nothing is reloaded.
 */

/** WAV basenames, matching the files in the repo's `sons/` directory. */
export const SOUND_FILES = [
  // Per-level theme samples (source/canvas.cc:704-771).
  'blip1', 'bloop', 'bubble2', 'ceramic3', 'chop2', 'click01', 'click_1', 'click_3',
  'corkpop', 'explod03', 'explod05', 'explod06', 'glass01', 'glass03', 'glass04',
  'hitwood1', 'knock', 'metal1', 'metal3', 'metal6', 'pop1', 'pwap2', 'smash2', 'splodge',
  'spring', 'tapdrip', 'water05_1', 'water05_2', 'water05_3', 'whistle1', 'whistle2',
  // Globals (source/quadra.cc:245-274).
  'clang3', 'cuckoo', 'glissup', 'handbell', 'hooter03', 'fadeout', 'w_bayo_0', 'whizz1',
  'zingle', 'potato_get',
  // Timed-game countdown, unused until multiplayer exists.
  't1min', 't30sec', 't20sec', 't10sec', 't5sec', 't4sec', 't3sec', 't2sec', 't1sec',
] as const;

export type SoundName = (typeof SOUND_FILES)[number];

/**
 * Globals loaded once at startup. Only the ones the port can currently reach are named;
 * the rest of the bank is still shipped, so wiring garbage, chat or the countdown later
 * needs no asset work.
 */
export const GLOBAL_SOUNDS = {
  /** `sons.levelup` — glissup.wav is 22050 Hz and played at 11000, an octave down. */
  levelUp: 'glissup',
  /** `sons.depose4` — the clang when a cascade settles. */
  cascade: 'clang3',
  /** `sons.pause` — cuckoo. */
  pause: 'cuckoo',
  /** `sons.start` — the hooter on a new game. */
  start: 'hooter03',
} as const satisfies Record<string, SoundName>;

/** The five samples a level theme swaps, named as in source/sons.h. */
export interface SoundTheme {
  /** `sons.flash` — line cleared. */
  flash: SoundName;
  /** `sons.depose3` / `depose2` / `depose` — the three landing variants, picked at random. */
  depose3: SoundName;
  depose2: SoundName;
  depose: SoundName;
  /** `sons.drip` — a successful rotation. */
  drip: SoundName;
}

/**
 * Ten themes, indexed by `(level - 1) % 10` — source/canvas.cc:661, :704-771. Theme 0 is the
 * `default:` arm of that switch. Note theme 1 uses `knock` for all three landing variants and
 * theme 6 repeats `glass03`, so those levels are genuinely less varied; that is upstream.
 */
export const SOUND_THEMES: readonly SoundTheme[] = [
  { flash: 'pwap2',    depose3: 'hitwood1',   depose2: 'chop2',      depose: 'metal3',   drip: 'tapdrip' },
  { flash: 'pwap2',    depose3: 'knock',      depose2: 'knock',      depose: 'knock',    drip: 'click_3' },
  { flash: 'blip1',    depose3: 'metal3',     depose2: 'metal1',     depose: 'metal6',   drip: 'click_1' },
  { flash: 'whistle1', depose3: 'tapdrip',    depose2: 'click01',    depose: 'click_3',  drip: 'click01' },
  { flash: 'spring',   depose3: 'pop1',       depose2: 'bloop',      depose: 'pwap2',    drip: 'corkpop' },
  { flash: 'whistle2', depose3: 'knock',      depose2: 'splodge',    depose: 'pop1',     drip: 'tapdrip' },
  { flash: 'glass04',  depose3: 'glass01',    depose2: 'glass03',    depose: 'glass03',  drip: 'click01' },
  { flash: 'bubble2',  depose3: 'water05_1',  depose2: 'water05_2',  depose: 'water05_3', drip: 'click01' },
  { flash: 'ceramic3', depose3: 'explod03',   depose2: 'explod05',   depose: 'explod06', drip: 'tapdrip' },
  { flash: 'smash2',   depose3: 'knock',      depose2: 'bloop',      depose: 'click_1',  drip: 'pop1' },
];

/** `num = (level-1) % 10` — source/canvas.cc:661. Levels are 1-based. */
export function themeForLevel(level: number): SoundTheme {
  const num = (((level - 1) % SOUND_THEMES.length) + SOUND_THEMES.length) % SOUND_THEMES.length;
  return SOUND_THEMES[num]!;
}
