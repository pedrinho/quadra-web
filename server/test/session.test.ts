import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  COOKIE,
  SESSION_TTL_MS,
  currentPlayer,
  endAllSessions,
  endSession,
  startSession,
} from '../src/session.js';
import { newId } from '../src/ids.js';

const NOW = 1_800_000_000_000;

async function player(): Promise<string> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO players (id, email, email_key, password_hash, display_name, display_name_key,
                          verified_at, created_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?, ?)`,
  )
    .bind(id, `${id}@example.com`, `${id}@example.com`, id, id.toLowerCase(), NOW, NOW)
    .run();
  return id;
}

/** A request carrying whatever `startSession` handed back. */
function signedIn(setCookie: string): Request {
  const token = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
  return new Request('https://quadra.test/v1/auth/me', {
    headers: { cookie: `${COOKIE}=${token}` },
  });
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM sessions').run();
  await env.DB.prepare('DELETE FROM players').run();
});

describe('sessions', () => {
  it('recognises the player it just signed in', async () => {
    const id = await player();
    const cookie = await startSession(env, id, NOW);
    const found = await currentPlayer(env, signedIn(cookie), NOW);
    expect(found?.id).toBe(id);
    expect(found?.verifiedAt).toBe(NOW);
  });

  it('never puts the token in the database', async () => {
    const id = await player();
    const cookie = await startSession(env, id, NOW);
    const token = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
    const rows = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.id).not.toBe(token);
    expect(rows.results[0]!.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries the flags that keep the cookie out of reach', async () => {
    const cookie = await startSession(env, await player(), NOW);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    // Lax, not Strict: the verification link arrives from a mail client, and Strict would not
    // send the cookie on that first navigation.
    expect(cookie).toContain('SameSite=Lax');
  });

  it('is nobody without a cookie, or with one that was never issued', async () => {
    await player();
    const bare = new Request('https://quadra.test/v1/auth/me');
    expect(await currentPlayer(env, bare, NOW)).toBeNull();

    const forged = new Request('https://quadra.test/v1/auth/me', {
      headers: { cookie: `${COOKIE}=not-a-real-token` },
    });
    expect(await currentPlayer(env, forged, NOW)).toBeNull();
  });

  it('expires, and clears the row on the way past', async () => {
    const id = await player();
    const request = signedIn(await startSession(env, id, NOW));

    expect(await currentPlayer(env, request, NOW + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(await currentPlayer(env, request, NOW + SESSION_TTL_MS)).toBeNull();

    const left = await env.DB.prepare('SELECT count(*) AS n FROM sessions').first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('signs out immediately rather than waiting for an expiry', async () => {
    const id = await player();
    const request = signedIn(await startSession(env, id, NOW));
    expect(await currentPlayer(env, request, NOW)).not.toBeNull();

    const cleared = await endSession(env, request);
    expect(cleared).toContain('Max-Age=0');
    expect(await currentPlayer(env, request, NOW)).toBeNull();
  });

  it('signs a player out everywhere, which is what a password change has to do', async () => {
    const id = await player();
    const a = signedIn(await startSession(env, id, NOW));
    const b = signedIn(await startSession(env, id, NOW));
    const other = await player();
    const c = signedIn(await startSession(env, other, NOW));

    await endAllSessions(env, id);

    expect(await currentPlayer(env, a, NOW)).toBeNull();
    expect(await currentPlayer(env, b, NOW)).toBeNull();
    // Somebody else's sessions are not collateral.
    expect(await currentPlayer(env, c, NOW)).not.toBeNull();
  });

  it('is nobody once the account is gone, cascade or no cascade', async () => {
    // The lookup joins players, so a deleted account cannot be signed in as even if the session
    // row outlives it — which is the guarantee worth having, since whether D1 enforces the
    // foreign key is not something this code should have to depend on.
    const id = await player();
    const request = signedIn(await startSession(env, id, NOW));
    await env.DB.prepare('DELETE FROM players WHERE id = ?').bind(id).run();
    expect(await currentPlayer(env, request, NOW)).toBeNull();
  });
});
