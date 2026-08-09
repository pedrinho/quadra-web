import type { Env } from '../src/env.js';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
    /** `web/public/assets/demo.qtape`, base64 — there is no filesystem in here. */
    TEST_DEMO_TAPE: string;
  }
}
