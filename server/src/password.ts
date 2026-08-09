/*
 * Password hashing.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * PBKDF2-HMAC-SHA256, because it is the only password KDF the Workers runtime implements
 * natively. Argon2id and scrypt are both better at resisting a GPU, and both would mean shipping
 * a WASM blob into a service whose entire dependency list is currently empty — a trade this is
 * not worth making at this size. The iteration count is OWASP's current figure for this
 * construction, and it is stored *in* the hash so it can be raised later without invalidating
 * everyone's password: `needsRehash` says when a stored hash is behind, and login is the place
 * that upgrades it.
 *
 * Format: `pbkdf2$sha256$<iterations>$<salt b64url>$<derived b64url>`.
 */

import { base64url, timingSafeEqual } from './ids.js';

/** OWASP's recommendation for PBKDF2-HMAC-SHA256. Raise it, never lower it. */
export const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = 'pbkdf2$sha256';

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
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;

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

function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
