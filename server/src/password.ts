/*
 * Password hashing.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * PBKDF2-HMAC-SHA256, because it is the only password KDF the Workers runtime implements
 * natively. Argon2id and scrypt are both better at resisting a GPU, and both would mean shipping
 * a WASM blob into a service whose entire dependency list is currently empty — a trade this is
 * not worth making at this size. The iteration count is stored *in* the hash so it can be raised
 * later without invalidating everyone's password: `needsRehash` says when a stored hash is
 * behind, and login is the place that upgrades it.
 *
 * Format: `pbkdf2$sha256$<iterations>$<salt b64url>$<derived b64url>`.
 */

import { base64url, fromBase64url, timingSafeEqual } from './ids.js';

/**
 * The most the production Workers runtime will derive: above this `deriveBits` throws "iteration
 * counts above 100000 are not supported". The local runtime the tests run in does not enforce it,
 * so nothing but this constant stands between a higher count and every sign-in failing only once
 * it is deployed.
 */
export const MAX_ITERATIONS = 100_000;

/**
 * As many as the runtime allows. OWASP asks for 600,000 for this construction, which Workers
 * cannot do; the gap is the price of a KDF that ships with the platform. Raise it, never lower
 * it, and never past `MAX_ITERATIONS`.
 */
export const ITERATIONS = MAX_ITERATIONS;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = 'pbkdf2$sha256';

/**
 * What an account that signs in some other way holds instead of a hash. Malformed on purpose:
 * `verifyPassword` refuses anything that does not parse, so nothing can ever match it.
 */
export const NO_PASSWORD = 'none';

const encoder = new TextEncoder();

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${base64url(salt)}$${base64url(derived)}`;
}

/**
 * Check a password against a stored hash.
 *
 * Never throws: a malformed hash is a failed login, not a 500. It cannot happen from this code,
 * but it can happen from a hand-edited row, and a crash there would be a way to tell that a
 * particular account exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || `${parts[0]}$${parts[1]}` !== PREFIX) return false;
  const iterations = Number(parts[2]);
  // Above the runtime's ceiling the derivation would throw, and a hash this build cannot check
  // is a failed sign-in, not a 500.
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    return false;
  }

  let salt: Uint8Array;
  try {
    salt = fromBase64url(parts[3]!);
  } catch {
    return false;
  }

  const derived = await derive(password, salt, iterations);
  return timingSafeEqual(base64url(derived), parts[4]!);
}

/** True when a stored hash was made with weaker parameters than this build uses. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 5 || `${parts[0]}$${parts[1]}` !== PREFIX) return true;
  return Number(parts[2]) < ITERATIONS;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}
