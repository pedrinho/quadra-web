/*
 * What the Worker is given.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

import type { Verifier } from './verifier.js';

export interface Env {
  /** The built site. Everything that is not `/v1/*` is served from here. */
  ASSETS: Fetcher;
  DB: D1Database;
  /** Tape bytes, keyed by run id. The database holds the key and nothing else about them. */
  TAPES: R2Bucket;
  /** Replays submitted runs, out of the request's own CPU budget. */
  VERIFIER: DurableObjectNamespace<Verifier>;
  /** This deployment's own address: where mailed links and Google's redirect back point. */
  PUBLIC_ORIGIN: string;
  /** The OAuth client from the Google console. Public; it appears in every sign-in URL. */
  GOOGLE_CLIENT_ID?: string;
  /** Set with `wrangler secret put`, or in `.dev.vars` locally. Without both, Google is off. */
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * `"on"` to offer e-mail and password accounts. Off on a deployment that cannot send mail —
   * registering needs a confirmation link — or whose CPU budget cannot afford the hashing.
   */
  PASSWORD_LOGIN?: string;
  /** Absent in development, and then the mailer prints the link instead of sending it. */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

/**
 * The ways of signing in this deployment offers. The page asks rather than assuming, so one
 * build serves a deployment with Google and no mail as well as one with both.
 */
export function signInMethods(env: Env): { google: boolean; password: boolean } {
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    password: env.PASSWORD_LOGIN === 'on',
  };
}
