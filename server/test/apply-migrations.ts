import { applyD1Migrations, env } from 'cloudflare:test';

// The same migration files `wrangler d1 migrations apply` runs, so a schema mistake fails here
// rather than in production.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
