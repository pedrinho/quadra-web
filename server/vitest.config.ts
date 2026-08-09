import { readFileSync } from 'node:fs';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

/*
 * Tests run inside workerd, against a real local D1 and a real local R2 — not against stubs of
 * them. A mock of D1 would prove that the handlers agree with the mock, which is not the question
 * anyone is asking.
 */
const migrations = await readD1Migrations('./migrations');

/*
 * The recording the front page plays, handed to the tests as a submittable run.
 *
 * There is no filesystem inside workerd, so it is read here and passed in as a binding — the same
 * route the migrations take. Read from the real file rather than copied into a fixture, so that
 * re-recording the demo moves the tests with it instead of leaving them on a stale copy.
 */
const demoTape = readFileSync('../web/public/assets/demo.qtape').toString('base64');

export default defineWorkersConfig({
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, TEST_DEMO_TAPE: demoTape },
        },
      },
    },
  },
});
