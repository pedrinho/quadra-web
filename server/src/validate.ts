/*
 * What the server is willing to accept from a form.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The client checks these too, because a form that only tells you what was wrong after a round
 * trip is a bad form. These are the checks that count.
 */

/** Deliberately loose. The confirmation mail is what proves an address, not a regular expression. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL = 254;

/*
 * What a name may be made of.
 *
 * The first version of this required a name to be alphanumeric with single separators *between*
 * the parts, which reads sensibly and rejects `sub[DdP]`, `[TAG]Ana` and `O'Brien` — a clan tag
 * and an apostrophe being about as ordinary as handles get. So the rule is inverted: say what is
 * actually dangerous and allow the rest.
 *
 * Dangerous is text that does not render as what it is. Control characters, zero-width spaces,
 * line and paragraph separators, and the bidi overrides that let a name reorder the row it sits
 * in. The two zero-width joiners are the exception — several scripts need them to spell ordinary
 * words, and excluding those scripts to tidy up a character class is not a trade worth making.
 */
const HOSTILE = /[\p{Cc}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}​‎‏‪-‮⁠-⁯﻿]/u;
/** Letters, marks and digits from any script, plus the punctuation people put in a handle. */
const NAME_CHARS = /^[\p{L}\p{M}\p{N} ‌‍[\]()_.\-|^~!?'+*#]+$/u;
/** Punctuation alone is not a name, and it folds away to nothing. */
const HAS_ALNUM = /[\p{L}\p{N}]/u;
export const MIN_NAME = 3;
export const MAX_NAME = 20;

/** Long enough to matter, and no upper bound worth arguing about below the size of a request. */
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 256;

/** Names the service uses for itself, or that would let a row impersonate the page around it. */
const RESERVED = new Set([
  'quadra',
  'admin',
  'administrator',
  'moderator',
  'mod',
  'system',
  'root',
  'staff',
  'support',
  'official',
  'guest',
  'anonymous',
  'deleted',
  'null',
  'undefined',
  'me',
]);

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed.length > MAX_EMAIL || !EMAIL.test(trimmed)) return null;
  return trimmed;
}

/** The column uniqueness is on, so two people cannot register the same address in two cases. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeName(name: string): string | null {
  const trimmed = name.trim();
  // Counted in code points: `[...s].length`, not `s.length`, or an emoji costs two of twenty
  // and an astral-plane script costs double throughout.
  const length = [...trimmed].length;
  if (length < MIN_NAME || length > MAX_NAME) return null;
  if (HOSTILE.test(trimmed)) return null;
  if (!NAME_CHARS.test(trimmed)) return null;
  if (!HAS_ALNUM.test(trimmed)) return null;
  // One space between things, never two: a run of them is a way to make a name look like two.
  if (/  /.test(trimmed)) return null;
  // Against the folded form, so `a.d.m.i.n` is as reserved as `admin`.
  if (RESERVED.has(nameKey(trimmed))) return null;
  return trimmed;
}

/**
 * The key uniqueness is on. Case-folded and stripped of everything that is not a letter or a
 * digit, so `[TAG]Ana`, `TAG_Ana` and `tagana` cannot all sit on the board being read as the
 * same person. Decoration is yours; the name underneath it is not yours twice.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export type PasswordProblem = 'too-short' | 'too-long' | 'too-obvious';

/** The handful that clear MIN_PASSWORD and are still the first thing anyone tries. */
const OBVIOUS = new Set([
  '1234567890',
  '12345678901',
  '123456789012',
  'password1!',
  'password123',
  'qwertyuiop',
  'letmein123',
  'iloveyou12',
  'quadraweb1',
]);

/**
 * Length, and then the two passwords everyone tries: their own address and their own name. A
 * breach-list check belongs here too and is a deliberate omission — it needs a service or a
 * bundled corpus, and neither is worth it before anyone has registered.
 */
export function checkPassword(
  password: string,
  email: string,
  name: string,
): PasswordProblem | null {
  if (password.length < MIN_PASSWORD) return 'too-short';
  if (password.length > MAX_PASSWORD) return 'too-long';
  const folded = password.toLowerCase();
  if (folded === email.toLowerCase() || folded === name.toLowerCase()) return 'too-obvious';
  // Only what is long enough to have got past the length check is worth naming here.
  if (OBVIOUS.has(folded)) return 'too-obvious';
  return null;
}
