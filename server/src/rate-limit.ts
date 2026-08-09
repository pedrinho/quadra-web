/*
 * Fixed-window counters.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A table rather than a second binding: every endpoint that needs limiting here is one a human
 * operates by hand — registering, signing in, asking for a link, starting a game — so the traffic
 * is tiny and a row is cheaper than another service to provision and reason about.
 *
 * Fixed windows, not a sliding log. A fixed window lets through up to twice the limit across a
 * boundary, which for "five sign-in attempts a minute" is a distinction without a difference.
 */

import type { Env } from './env.js';

export interface Limit {
  /** What is being limited. Part of the key, so buckets never collide. */
  bucket: string;
  /** Attempts allowed per window. */
  limit: number;
  windowMs: number;
}

export const LIMITS = {
  /** Registration is expensive for us and cheap for an attacker, so this one is tight. */
  registerPerIp: { bucket: 'register-ip', limit: 5, windowMs: 60 * 60 * 1000 },
  loginPerIp: { bucket: 'login-ip', limit: 20, windowMs: 15 * 60 * 1000 },
  /** Per account, so a password cannot be ground down from a spread of addresses. */
  loginPerAccount: { bucket: 'login-account', limit: 10, windowMs: 15 * 60 * 1000 },
  /** Anything that puts a message in somebody's inbox, keyed by that inbox. */
  mailPerAddress: { bucket: 'mail-address', limit: 4, windowMs: 60 * 60 * 1000 },
  mailPerIp: { bucket: 'mail-ip', limit: 10, windowMs: 60 * 60 * 1000 },
  /** A seed grant per player. Generous: restarting a game is normal, farming grants is not. */
  grantPerPlayer: { bucket: 'grant-player', limit: 120, windowMs: 60 * 60 * 1000 },
  submitPerPlayer: { bucket: 'submit-player', limit: 60, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, Limit>;

/**
 * Count one attempt. True when it is allowed.
 *
 * The increment and the read are one statement, so two requests arriving together cannot both
 * see the same count and both be let through.
 */
export async function allow(
  env: Env,
  limit: Limit,
  subject: string,
  now: number,
): Promise<boolean> {
  const window = Math.floor(now / limit.windowMs);
  const id = `${limit.bucket}:${subject}:${window}`;
  const expiresAt = (window + 1) * limit.windowMs;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (id, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT (id) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(id, expiresAt)
    .first<{ count: number }>();

  return (row?.count ?? 1) <= limit.limit;
}

/**
 * Drop windows that have closed.
 *
 * There is no scheduled job here, so this rides along on the requests that create rows. It is
 * cheap, it is bounded, and it keeps the table proportional to current traffic rather than to
 * all traffic ever.
 */
export async function sweep(env: Env, now: number): Promise<void> {
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now).run();
}
