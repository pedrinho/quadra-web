/*
 * What the Worker is given.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

export interface Env {
  /** The built site. Everything that is not `/v1/*` is served from here. */
  ASSETS: Fetcher;
  DB: D1Database;
  /** Tape bytes, keyed by run id. The database holds the key and nothing else about them. */
  TAPES: R2Bucket;
  /** Where the links in an e-mail should point. */
  PUBLIC_ORIGIN: string;
  /** Absent in development, and then the mailer prints the link instead of sending it. */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}
