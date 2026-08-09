/*
 * Signed-in state.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A session is a row, not a signed token. That costs a lookup on every authenticated request and
 * buys the thing a game service actually needs: signing out, or being signed out, takes effect
 * immediately rather than whenever the token happens to expire.
 */

import type { Env } from './env.js';
import { cookies, clearCookie, setCookie } from './http.js';
import { digest, newToken } from './ids.js';

export const COOKIE = 'quadra_session';
/** Thirty days. Long enough that a player who comes back next month is still themselves. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** How stale `last_seen_at` may get before a read pays for a write. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface Player {
  id: string;
  email: string;
  displayName: string;
  verifiedAt: number | null;
  createdAt: number;
}

/** Mint a session and return the `Set-Cookie` that carries it. */
export async function startSession(env: Env, playerId: string, now: number): Promise<string> {
  const token = newToken();
  await env.DB.prepare(
    `INSERT INTO sessions (id, player_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(await digest(token), playerId, now, now + SESSION_TTL_MS, now)
    .run();
  return setCookie(COOKIE, token, Math.floor(SESSION_TTL_MS / 1000));
}

/**
 * Who is asking, or null.
 *
 * An expired row is deleted on the way past rather than left to accumulate — there is no cron
 * here, and the rows that matter are the ones someone is still using.
 */
export async function currentPlayer(
  env: Env,
  request: Request,
  now: number,
): Promise<Player | null> {
  const token = cookies(request).get(COOKIE);
  if (!token) return null;
  const id = await digest(token);

  const row = await env.DB.prepare(
    `SELECT s.expires_at AS expires_at, s.last_seen_at AS last_seen_at,
            p.id AS id, p.email AS email, p.display_name AS display_name,
            p.verified_at AS verified_at, p.created_at AS created_at
       FROM sessions s JOIN players p ON p.id = s.player_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      expires_at: number;
      last_seen_at: number;
      id: string;
      email: string;
      display_name: string;
      verified_at: number | null;
      created_at: number;
    }>();

  if (!row) return null;
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }

  if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now, id).run();
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

/** End the session this request carries, and return the `Set-Cookie` that forgets it. */
export async function endSession(env: Env, request: Request): Promise<string> {
  const token = cookies(request).get(COOKIE);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await digest(token)).run();
  }
  return clearCookie(COOKIE);
}

/** Sign a player out everywhere. What a password change has to do. */
export async function endAllSessions(env: Env, playerId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE player_id = ?').bind(playerId).run();
}
