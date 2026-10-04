/*
 * Where a submitted run is replayed.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A Durable Object rather than the request handler, for one reason: CPU. On Cloudflare's free
 * plan a Worker gets 10 ms per request, and replaying a ten-minute run costs about thirty — so
 * the handler could only ever rank short games. A Durable Object is allowed 30 s per call on the
 * same plan, and the Worker waiting on one spends none of its own budget.
 *
 * Nothing else moves. It is the same `verify`, imported from the same client module the browser
 * ran, with the same limits; the only difference is which isolate does the arithmetic. Holding
 * no state, it never touches its storage — the object exists only to be somewhere with the time
 * to think.
 */

import { DurableObject } from 'cloudflare:workers';
import { verify, type VerifyResult } from 'quadra-web/replay/verify';

import type { Env } from './env.js';

export class Verifier extends DurableObject<Env> {
  /** Replay a tape and say what it scored. Never throws: `verify` reports, it does not raise. */
  check(bytes: Uint8Array, maxBytes: number): VerifyResult {
    return verify(bytes, { limits: { maxBytes } });
  }
}
