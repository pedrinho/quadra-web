/*
 * Signing in with Google.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The authorization-code flow with PKCE, done by hand: three routes and one `fetch`, rather than a
 * library for a protocol this small. What it buys is an account with no password and no mail —
 * Google has already confirmed the address — on a deployment that has neither a mail provider
 * nor the CPU to hash a password inside a request.
 *
 * The id_token is not signature-checked, and that is deliberate rather than an omission. It does
 * not come from the browser: this Worker fetches it from Google's token endpoint over TLS in
 * exchange for a code and the client secret, and Google's own documentation says a token
 * obtained that way can be trusted as it stands. Its claims are still checked — issuer,
 * audience, expiry, and that the address is verified.
 *
 * A first sign-in does not create a player. It leaves a `signups` row and sends the browser back
 * with a token, and the player exists only once they have chosen the name that goes on the
 * board. Google knows their real name; the board does not need to.
 */

import { publicPlayer, loadPlayer } from './auth.js';
import { signInMethods, type Env } from './env.js';
import {
  clearCookie,
  clientIp,
  cookies,
  fail,
  json,
  readJson,
  redirect,
  setCookie,
  str,
} from './http.js';
import { base64url, digest, fromBase64url, newId, newToken, timingSafeEqual } from './ids.js';
import { NO_PASSWORD } from './password.js';
import { LIMITS, allow } from './rate-limit.js';
import { startSession } from './session.js';
import { MAX_NAME, emailKey, nameKey, normalizeEmail, normalizeName } from './validate.js';

const PROVIDER = 'google';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Carries the state and the PKCE verifier from the start of a sign-in to its callback. */
const FLOW_COOKIE = 'quadra_oauth';
/** Scoped to the flow, so it rides on the two requests that need it and on nothing else. */
const FLOW_PATH = '/v1/auth/google';
/** Long enough to pick an account and type a password at Google; no longer. */
const FLOW_TTL_S = 10 * 60;
/** How long a first-time player has to choose a name before signing in again is simpler. */
const SIGNUP_TTL_MS = 30 * 60 * 1000;

/** Where a sign-in may send the browser back to. Anything else would be an open redirect. */
const RETURNS = new Set(['/', '/records', '/museum']);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Begin: remember a state and a verifier, and send the browser to Google. */
export async function googleStart(
  env: Env,
  request: Request,
  url: URL,
  now: number,
): Promise<Response> {
  if (!signInMethods(env).google) return fail('not-found', 404);
  const back = returnPath(url.searchParams.get('return'));
  // A redirect rather than a 429: this is a navigation, and a status code would leave the player
  // looking at a bare JSON body instead of the page they came from.
  if (!(await allow(env, LIMITS.oauthPerIp, clientIp(request), now))) {
    return redirect(`${back}?signin=failed`);
  }

  const state = newToken();
  const verifier = newToken();
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))),
  );

  const target = new URL(AUTHORIZE);
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Always ask which account: on a shared machine, the one already signed in to Google is
    // not necessarily the one that should be on the board.
    prompt: 'select_account',
  }).toString();

  // None of the three parts can contain a dot: two are base64url and the third is one of
  // `RETURNS`.
  const flow = `${state}.${verifier}.${back}`;
  return redirect(target.toString(), setCookie(FLOW_COOKIE, flow, FLOW_TTL_S, FLOW_PATH));
}

/**
 * Google sends the browser back here. Every way this can go wrong — the player pressed cancel,
 * the state does not match, Google said no — ends the same way: back where they started, with
 * `?signin=failed`, and the detail in the log. The page has nothing more useful to say.
 */
export async function googleCallback(
  env: Env,
  request: Request,
  url: URL,
  now: number,
): Promise<Response> {
  if (!signInMethods(env).google) return fail('not-found', 404);

  const [state = '', verifier = '', saved = ''] = (cookies(request).get(FLOW_COOKIE) ?? '').split(
    '.',
  );
  const back = returnPath(saved);
  const forget = clearCookie(FLOW_COOKIE, FLOW_PATH);
  const failed = () => redirect(`${back}?signin=failed`, forget);

  const code = url.searchParams.get('code');
  const given = url.searchParams.get('state') ?? '';
  if (!code || !state || !verifier || !timingSafeEqual(given, state)) return failed();

  const who = await exchange(env, code, verifier, now);
  if (!who) return failed();

  const known = await env.DB.prepare(
    'SELECT player_id FROM identities WHERE provider = ? AND subject = ?',
  )
    .bind(PROVIDER, who.subject)
    .first<{ player_id: string }>();
  if (known) {
    return redirect(back, await startSession(env, known.player_id, now), forget);
  }

  // An account already holds this address — registered with a password, before Google was
  // offered. Google has just proved the address as surely as a confirmation link would, so the
  // two are joined rather than the player being made to choose a second name.
  //
  // If that account never confirmed the address, though, whoever registered it did not prove
  // they own it, and may not: registering somebody else's address and waiting for them to sign
  // in with Google would otherwise hand the squatter a working password to the owner's account.
  // So an unconfirmed account loses its password and every session on the way in.
  const existing = await env.DB.prepare('SELECT id, verified_at FROM players WHERE email_key = ?')
    .bind(emailKey(who.email))
    .first<{ id: string; verified_at: number | null }>();
  if (existing) {
    const link = [
      env.DB.prepare(
        'INSERT INTO identities (provider, subject, player_id, created_at) VALUES (?, ?, ?, ?)',
      ).bind(PROVIDER, who.subject, existing.id, now),
    ];
    if (existing.verified_at === null) {
      link.push(
        env.DB.prepare(
          'UPDATE players SET verified_at = ?, password_hash = ? WHERE id = ?',
        ).bind(now, NO_PASSWORD, existing.id),
        env.DB.prepare('DELETE FROM sessions WHERE player_id = ?').bind(existing.id),
      );
    }
    await env.DB.batch(link);
    return redirect(back, await startSession(env, existing.id, now), forget);
  }

  const token = newToken();
  await env.DB.batch([
    // Ride along on the requests that create rows, as the rate limiter does: there is no cron.
    env.DB.prepare('DELETE FROM signups WHERE expires_at <= ?').bind(now),
    env.DB.prepare(
      `INSERT INTO signups (id, provider, subject, email, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(await digest(token), PROVIDER, who.subject, who.email, now, now + SIGNUP_TTL_MS),
  ]);
  return redirect(`${back}?welcome=${token}`, forget);
}

/** A first-time player names themselves, and only now becomes a player. */
export async function googleFinish(env: Env, request: Request, now: number): Promise<Response> {
  if (!signInMethods(env).google) return fail('not-found', 404);
  const body = await readJson(request);
  if (!body.ok) return body.response;

  const token = str(body.value, 'token', 200);
  const rawName = str(body.value, 'displayName', MAX_NAME * 4);
  if (!token || !rawName) return fail('bad-request', 400);
  const displayName = normalizeName(rawName);
  if (!displayName) return fail('bad-name', 400);

  const id = await digest(token);
  const signup = await env.DB.prepare(
    'SELECT subject, email, expires_at FROM signups WHERE id = ?',
  )
    .bind(id)
    .first<{ subject: string; email: string; expires_at: number }>();
  if (!signup || signup.expires_at <= now) return fail('bad-token', 400);

  // Checked before the token is spent, so a taken name costs another try rather than another
  // trip to Google.
  const taken = () =>
    env.DB.prepare('SELECT 1 FROM players WHERE display_name_key = ?')
      .bind(nameKey(displayName))
      .first();
  if (await taken()) return fail('name-taken', 409);

  // Two tabs, two sign-ins, one person: the other tab may have finished first.
  const known = await env.DB.prepare(
    'SELECT player_id FROM identities WHERE provider = ? AND subject = ?',
  )
    .bind(PROVIDER, signup.subject)
    .first<{ player_id: string }>();

  let playerId = known?.player_id;
  if (playerId) {
    await env.DB.prepare('DELETE FROM signups WHERE id = ?').bind(id).run();
  } else {
    playerId = newId();
    try {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM signups WHERE id = ?').bind(id),
        env.DB.prepare(
          `INSERT INTO players (id, email, email_key, password_hash, display_name,
                                display_name_key, verified_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          playerId,
          signup.email,
          emailKey(signup.email),
          NO_PASSWORD,
          displayName,
          nameKey(displayName),
          now,
          now,
        ),
        env.DB.prepare(
          'INSERT INTO identities (provider, subject, player_id, created_at) VALUES (?, ?, ?, ?)',
        ).bind(PROVIDER, signup.subject, playerId, now),
      ]);
    } catch {
      // A unique index refused the row: somebody took the name, or registered the address,
      // between the check above and now. The batch is one transaction, so nothing was spent.
      return (await taken()) ? fail('name-taken', 409) : fail('bad-token', 400);
    }
  }

  const cookie = await startSession(env, playerId, now);
  const player = await loadPlayer(env, playerId);
  return player
    ? json({ player: publicPlayer(player) }, 200, { 'set-cookie': cookie })
    : fail('bad-token', 400);
}

/* --- internals ----------------------------------------------------------- */

function redirectUri(env: Env): string {
  return `${env.PUBLIC_ORIGIN}${FLOW_PATH}/callback`;
}

function returnPath(value: string | null): string {
  return value && RETURNS.has(value) ? value : '/';
}

/** Trade the code for an id_token, and read who it says this is. Null for any failure. */
async function exchange(
  env: Env,
  code: string,
  verifier: string,
  now: number,
): Promise<{ subject: string; email: string } | null> {
  let res: Response;
  try {
    res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(env),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
  } catch (err) {
    console.error('[google] token request failed:', err);
    return null;
  }
  if (!res.ok) {
    console.error(`[google] token endpoint answered ${res.status}: ${await res.text()}`);
    return null;
  }

  let claims: Record<string, unknown>;
  try {
    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string') return null;
    const payload = body.id_token.split('.')[1] ?? '';
    claims = JSON.parse(decoder.decode(fromBase64url(payload))) as Record<string, unknown>;
  } catch (err) {
    console.error('[google] unreadable token response:', err);
    return null;
  }

  if (!ISSUERS.has(String(claims['iss']))) return null;
  if (claims['aud'] !== env.GOOGLE_CLIENT_ID) return null;
  if (typeof claims['exp'] !== 'number' || claims['exp'] * 1000 <= now) return null;
  // An address Google has not confirmed is a claim, not a proof, and the account is keyed on it.
  if (claims['email_verified'] !== true) return null;
  if (typeof claims['sub'] !== 'string' || claims['sub'].length === 0) return null;
  const email = typeof claims['email'] === 'string' ? normalizeEmail(claims['email']) : null;
  if (!email) return null;

  return { subject: claims['sub'], email };
}
