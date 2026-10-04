/*
 * The Worker: the site, and the board behind it.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The one thing that makes this service worth anything is that it runs the *same* simulation the
 * browser ran. `verify` is imported from the client package rather than reimplemented or vendored,
 * so there is no second engine that could quietly disagree with the first — and if the two ever
 * did disagree, a score would be a claim rather than a proof.
 *
 * Everything that is not `/v1/*` is the site, served straight from the assets binding. One Worker
 * for both means the session cookie is first-party and there is no CORS layer to get wrong.
 */

import { SIM_VERSION, TAPE_FORMAT_VERSION } from 'quadra-web/replay/version';

import { signInMethods, type Env } from './env.js';
import { fail, json } from './http.js';
import {
  deleteAccount,
  forgot,
  login,
  logout,
  me,
  register,
  resendVerification,
  reset,
  verifyEmail,
} from './auth.js';
import { getRun, getTape, leaderboard } from './board.js';
import { googleCallback, googleFinish, googleStart } from './google.js';
import { startRun, submitRun } from './runs.js';

// The runtime finds a Durable Object class by its export from the entry module.
export { Verifier } from './verifier.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/')) return env.ASSETS.fetch(request);

    try {
      return await api(request, env, url);
    } catch (err) {
      // A handler that throws is a bug here, not a message for the client. It gets a code and
      // nothing else; the detail goes to the log.
      console.error(`[${request.method} ${url.pathname}]`, err);
      return fail('internal', 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  // One clock per request. Handlers take it rather than reading their own, so a test can place a
  // request at any moment it likes and every expiry in that request agrees about when it is.
  const now = Date.now();
  const route = `${request.method} ${url.pathname}`;

  switch (route) {
    case 'GET /v1/health':
      return json({
        ok: true,
        simVersion: SIM_VERSION,
        tapeFormatVersion: TAPE_FORMAT_VERSION,
      });

    case 'POST /v1/auth/logout':
      return logout(env, request);
    case 'GET /v1/auth/me':
      return me(env, request, now);
    case 'DELETE /v1/auth/me':
      return deleteAccount(env, request, now);

    case 'GET /v1/auth/google/start':
      return googleStart(env, request, url, now);
    case 'GET /v1/auth/google/callback':
      return googleCallback(env, request, url, now);
    case 'POST /v1/auth/google/finish':
      return googleFinish(env, request, now);

    case 'POST /v1/runs/start':
      return startRun(env, request, now);
    case 'POST /v1/runs':
      return submitRun(env, request, now);
    case 'GET /v1/leaderboard':
      return leaderboard(env, url, now);
  }

  // E-mail and password, where this deployment offers them. Where it does not, the routes do
  // not exist: a register that answers "sent" for a mail that never leaves would be a lie.
  if (signInMethods(env).password) {
    switch (route) {
      case 'POST /v1/auth/register':
        return register(env, request, now);
      case 'POST /v1/auth/verify':
        return verifyEmail(env, request, now);
      case 'POST /v1/auth/resend':
        return resendVerification(env, request, now);
      case 'POST /v1/auth/login':
        return login(env, request, now);
      case 'POST /v1/auth/forgot':
        return forgot(env, request, now);
      case 'POST /v1/auth/reset':
        return reset(env, request, now);
    }
  }

  // The two that carry an id in the path. Everything else is a fixed route, so this stays a
  // pair of prefix checks rather than a router.
  const run = /^\/v1\/runs\/([A-Za-z0-9_-]{1,64})(\/tape)?$/.exec(url.pathname);
  if (run && request.method === 'GET') {
    return run[2] ? getTape(env, run[1]!) : getRun(env, run[1]!);
  }

  return fail('not-found', 404);
}
