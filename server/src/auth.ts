/*
 * Registering, and proving it later.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * One property shapes most of what looks like over-carefulness below: **nothing here reveals
 * whether an address has an account.** Registering with an address that is already taken, asking
 * to reset a password for one that is not, and signing in with a wrong password all answer the
 * same way and take the same path. An e-mail address is not ours to confirm to whoever asks, and
 * a leaderboard is exactly the sort of thing people try their friends' addresses against.
 *
 * A display name is the opposite: it is printed on a public board, so a collision on one is
 * reported plainly. There is nothing to protect.
 */

import type { Env } from './env.js';
import { clearCookie, clientIp, fail, json, readJson, str } from './http.js';
import { digest, newId, newToken } from './ids.js';
import { resetMail, send, verifyMail } from './mail.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import { LIMITS, allow, sweep } from './rate-limit.js';
import {
  COOKIE,
  currentPlayer,
  endAllSessions,
  endSession,
  startSession,
  type Player,
} from './session.js';
import {
  MAX_NAME,
  MAX_PASSWORD,
  checkPassword,
  emailKey,
  nameKey,
  normalizeEmail,
  normalizeName,
} from './validate.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
/** What every mail-bearing endpoint says, whether or not it sent anything. */
const SENT = { sent: true };

/**
 * A hash of a password nobody knows, so that signing in to an address with no account spends the
 * same 600,000 iterations as signing in to one that exists. Without it, "no such address" answers
 * in a millisecond and "wrong password" in a few hundred, and the difference is a working probe.
 *
 * Checked in rather than generated at startup: deriving it would cost every cold start the same
 * 600,000 iterations, and there is nothing to hide here — knowing the salt of a password that was
 * never chosen gets an attacker nowhere. What matters is only that the work happens.
 */
const NO_SUCH_ACCOUNT =
  'pbkdf2$sha256$600000$fZ8kQq3rW1nXvTgYbHcJdA$Kx7pQmZ2vLnR8sT4wYhE6bNcF1jUgA0oPzXdVeMlSrI';

export function publicPlayer(player: Player): Record<string, unknown> {
  return {
    id: player.id,
    displayName: player.displayName,
    email: player.email,
    verified: player.verifiedAt !== null,
    createdAt: player.createdAt,
  };
}

export async function register(env: Env, request: Request, now: number): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;

  const rawEmail = str(body.value, 'email', 320);
  const rawName = str(body.value, 'displayName', MAX_NAME * 4);
  const password = typeof body.value['password'] === 'string' ? body.value['password'] : '';
  if (!rawEmail || !rawName) return fail('bad-request', 400);

  const email = normalizeEmail(rawEmail);
  if (!email) return fail('bad-email', 400);
  const displayName = normalizeName(rawName);
  if (!displayName) return fail('bad-name', 400);
  const problem = checkPassword(password, email, displayName);
  if (problem) return fail(`bad-password-${problem}`, 400);

  if (!(await allow(env, LIMITS.registerPerIp, clientIp(request), now))) {
    return fail('rate-limited', 429);
  }

  // Before the mail quota is spent: the name is public, so a clash is worth saying out loud, and
  // it is the one thing here the player has to fix before any mail is worth sending.
  const nameTaken = await env.DB.prepare('SELECT 1 FROM players WHERE display_name_key = ?')
    .bind(nameKey(displayName))
    .first();
  if (nameTaken) return fail('name-taken', 409);

  if (!(await allow(env, LIMITS.mailPerAddress, emailKey(email), now))) return json(SENT, 202);

  const existing = await env.DB.prepare('SELECT id FROM players WHERE email_key = ?')
    .bind(emailKey(email))
    .first<{ id: string }>();

  if (existing) {
    // Same status, same shape, same latency as a real registration. What differs is which
    // message arrives, and only the owner of the address ever sees that.
    await send(env, {
      to: email,
      subject: 'You already have a Quadra account',
      text: [
        'Someone tried to register this address, which already has an account.',
        '',
        `Sign in: ${env.PUBLIC_ORIGIN}/`,
        '',
        'If you have forgotten the password, use the reset link on that page.',
      ].join('\n'),
    });
    return json(SENT, 202);
  }

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO players (id, email, email_key, password_hash, display_name, display_name_key,
                          verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      id,
      email,
      emailKey(email),
      await hashPassword(password),
      displayName,
      nameKey(displayName),
      now,
    )
    .run();

  await sendVerification(env, id, email, now);
  return json(SENT, 202);
}

export async function verifyEmail(env: Env, request: Request, now: number): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const token = str(body.value, 'token', 200);
  if (!token) return fail('bad-request', 400);

  const row = await consumeToken(env, token, 'verify', now);
  if (!row) return fail('bad-token', 400);

  await env.DB.prepare('UPDATE players SET verified_at = ? WHERE id = ? AND verified_at IS NULL')
    .bind(now, row.player_id)
    .run();

  // Confirming the address signs you in: you have just proved you own it, and asking for the
  // password again immediately teaches nothing and loses people.
  const cookie = await startSession(env, row.player_id, now);
  const player = await loadPlayer(env, row.player_id);
  return player
    ? json({ player: publicPlayer(player) }, 200, { 'set-cookie': cookie })
    : fail('bad-token', 400);
}

export async function resendVerification(
  env: Env,
  request: Request,
  now: number,
): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const rawEmail = str(body.value, 'email', 320);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (!email) return fail('bad-email', 400);

  if (!(await allow(env, LIMITS.mailPerIp, clientIp(request), now))) return json(SENT, 202);
  if (!(await allow(env, LIMITS.mailPerAddress, emailKey(email), now))) return json(SENT, 202);

  const row = await env.DB.prepare(
    'SELECT id, email, verified_at FROM players WHERE email_key = ?',
  )
    .bind(emailKey(email))
    .first<{ id: string; email: string; verified_at: number | null }>();

  if (row && row.verified_at === null) await sendVerification(env, row.id, row.email, now);
  return json(SENT, 202);
}

export async function login(env: Env, request: Request, now: number): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const rawEmail = str(body.value, 'email', 320);
  const password = typeof body.value['password'] === 'string' ? body.value['password'] : '';
  if (!rawEmail || password.length > MAX_PASSWORD) return fail('bad-credentials', 401);
  const email = normalizeEmail(rawEmail);
  if (!email) return fail('bad-credentials', 401);

  if (!(await allow(env, LIMITS.loginPerIp, clientIp(request), now))) {
    return fail('rate-limited', 429);
  }
  if (!(await allow(env, LIMITS.loginPerAccount, emailKey(email), now))) {
    return fail('rate-limited', 429);
  }

  const row = await env.DB.prepare(
    'SELECT id, password_hash FROM players WHERE email_key = ?',
  )
    .bind(emailKey(email))
    .first<{ id: string; password_hash: string }>();

  // No early return on a missing account: hashing anyway keeps the timing of "no such address"
  // and "wrong password" the same, and those two must not be distinguishable from out here.
  const stored = row?.password_hash ?? NO_SUCH_ACCOUNT;
  const good = await verifyPassword(password, stored);
  if (!row || !good) return fail('bad-credentials', 401);

  // Signing in is the only moment we hold the plaintext, so it is the only place a hash made
  // with weaker parameters can be quietly brought up to date.
  if (needsRehash(stored)) {
    await env.DB.prepare('UPDATE players SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(password), row.id)
      .run();
  }

  const cookie = await startSession(env, row.id, now);
  const player = await loadPlayer(env, row.id);
  return player
    ? json({ player: publicPlayer(player) }, 200, { 'set-cookie': cookie })
    : fail('bad-credentials', 401);
}

export async function logout(env: Env, request: Request): Promise<Response> {
  const cookie = await endSession(env, request);
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}

export async function me(env: Env, request: Request, now: number): Promise<Response> {
  const player = await currentPlayer(env, request, now);
  return json({ player: player ? publicPlayer(player) : null });
}

export async function forgot(env: Env, request: Request, now: number): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const rawEmail = str(body.value, 'email', 320);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  // Even a malformed address answers the same way. Anything else is a probe that works.
  if (!email) return json(SENT, 202);

  if (!(await allow(env, LIMITS.mailPerIp, clientIp(request), now))) return json(SENT, 202);
  if (!(await allow(env, LIMITS.mailPerAddress, emailKey(email), now))) return json(SENT, 202);

  const row = await env.DB.prepare('SELECT id, email FROM players WHERE email_key = ?')
    .bind(emailKey(email))
    .first<{ id: string; email: string }>();

  if (row) {
    const token = await issueToken(env, row.id, 'reset', now, RESET_TTL_MS);
    await send(env, { to: row.email, ...resetMail(env.PUBLIC_ORIGIN, token) });
  }
  return json(SENT, 202);
}

export async function reset(env: Env, request: Request, now: number): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const token = str(body.value, 'token', 200);
  const password = typeof body.value['password'] === 'string' ? body.value['password'] : '';
  if (!token) return fail('bad-request', 400);

  const row = await consumeToken(env, token, 'reset', now);
  if (!row) return fail('bad-token', 400);

  const player = await loadPlayer(env, row.player_id);
  if (!player) return fail('bad-token', 400);

  const problem = checkPassword(password, player.email, player.displayName);
  if (problem) return fail(`bad-password-${problem}`, 400);

  await env.DB.prepare('UPDATE players SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(password), player.id)
    .run();

  // Whoever asked for this may have been locked out by someone else. Everything signs out,
  // including whatever session the intruder was holding.
  await endAllSessions(env, player.id);

  // Reaching the reset link proves the address as surely as the verification link does.
  await env.DB.prepare('UPDATE players SET verified_at = ? WHERE id = ? AND verified_at IS NULL')
    .bind(now, player.id)
    .run();

  const cookie = await startSession(env, player.id, now);
  const fresh = await loadPlayer(env, player.id);
  return json({ player: fresh ? publicPlayer(fresh) : null }, 200, { 'set-cookie': cookie });
}

/**
 * Close an account.
 *
 * The runs stay on the board, detached and under a tombstone name. Deleting them would rewrite
 * the history of everyone who was ranked against them, and the row holds nothing personal once
 * the player is gone — it is a score and a recording of a game.
 */
export async function deleteAccount(env: Env, request: Request, now: number): Promise<Response> {
  const player = await currentPlayer(env, request, now);
  if (!player) return fail('unauthenticated', 401);

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const password = typeof body.value['password'] === 'string' ? body.value['password'] : '';

  const row = await env.DB.prepare('SELECT password_hash FROM players WHERE id = ?')
    .bind(player.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return fail('bad-credentials', 401);
  }

  await env.DB.batch([
    env.DB.prepare('UPDATE runs SET player_id = NULL WHERE player_id = ?').bind(player.id),
    env.DB.prepare('DELETE FROM sessions WHERE player_id = ?').bind(player.id),
    env.DB.prepare('DELETE FROM email_tokens WHERE player_id = ?').bind(player.id),
    env.DB.prepare('DELETE FROM grants WHERE player_id = ?').bind(player.id),
    env.DB.prepare('DELETE FROM players WHERE id = ?').bind(player.id),
  ]);

  return json({ ok: true }, 200, { 'set-cookie': clearCookie(COOKIE) });
}

/* --- internals ----------------------------------------------------------- */

async function sendVerification(
  env: Env,
  playerId: string,
  email: string,
  now: number,
): Promise<void> {
  const token = await issueToken(env, playerId, 'verify', now, VERIFY_TTL_MS);
  await send(env, { to: email, ...verifyMail(env.PUBLIC_ORIGIN, token) });
}

/** Issue a link token, invalidating any earlier one of the same kind: only the newest works. */
async function issueToken(
  env: Env,
  playerId: string,
  kind: 'verify' | 'reset',
  now: number,
  ttlMs: number,
): Promise<string> {
  const token = newToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_tokens WHERE player_id = ? AND kind = ?').bind(
      playerId,
      kind,
    ),
    env.DB.prepare(
      `INSERT INTO email_tokens (id, player_id, kind, created_at, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).bind(await digest(token), playerId, kind, now, now + ttlMs),
  ]);
  await sweep(env, now);
  return token;
}

/** Spend a link token. Deleted rather than marked, so it cannot be spent twice. */
async function consumeToken(
  env: Env,
  token: string,
  kind: 'verify' | 'reset',
  now: number,
): Promise<{ player_id: string } | null> {
  const id = await digest(token);
  const row = await env.DB.prepare(
    'SELECT player_id, expires_at FROM email_tokens WHERE id = ? AND kind = ?',
  )
    .bind(id, kind)
    .first<{ player_id: string; expires_at: number }>();
  if (!row) return null;

  await env.DB.prepare('DELETE FROM email_tokens WHERE id = ?').bind(id).run();
  if (row.expires_at <= now) return null;
  return { player_id: row.player_id };
}

async function loadPlayer(env: Env, id: string): Promise<Player | null> {
  const row = await env.DB.prepare(
    'SELECT id, email, display_name, verified_at, created_at FROM players WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: string;
      email: string;
      display_name: string;
      verified_at: number | null;
      created_at: number;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}
