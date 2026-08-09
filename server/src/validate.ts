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

/**
 * Letters, digits, and a few separators between them. No leading or trailing punctuation, no runs
 * of it, and no whitespace at all: a name on a leaderboard row has to be one word-shaped thing.
 */
const NAME = /^[\p{L}\p{N}]+([ _.-][\p{L}\p{N}]+)*$/u;
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
  if (trimmed.length < MIN_NAME || trimmed.length > MAX_NAME) return null;
  if (!NAME.test(trimmed)) return null;
  if (RESERVED.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * The key uniqueness is on. Case-folded, and with the separators removed, so that `great_player`
 * cannot sit next to `greatplayer` on the same board and be read as the same person.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[ _.-]/g, '');
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
