/*
 * Random identifiers, digests, and comparing them without leaking how far you got.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Every secret this service hands out — a session cookie, a verification link, a reset link — is
 * an opaque 256-bit random string, and the database stores only its SHA-256. So a stolen copy of
 * the database contains nothing anyone can sign in with, and there is no signing key to rotate or
 * leak. The cost is a row lookup per request, which is the cost of being able to revoke by
 * deleting rather than by waiting for an expiry.
 */

const encoder = new TextEncoder();

/** 256 bits of randomness, in a form that survives a URL and a cookie unescaped. */
export function newToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A public identifier for a row. Random rather than sequential: ids end up in URLs. */
export function newId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** What gets stored in place of a token. */
export async function digest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return hex(new Uint8Array(bytes));
}

/**
 * Compare in time that does not depend on where the first difference is.
 *
 * Written out rather than reaching for the runtime's own: this also runs under the test pool and
 * in Node, and a comparison that is only constant-time in production is not a comparison anyone
 * should trust.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
