import { defineConfig } from 'vite';

/*
 * In production one Worker serves both this site and the API, so `/v1` is same-origin and the
 * session cookie is first-party. `vite dev` has to reproduce that or nothing signed-in works:
 * a cross-origin request would not carry the cookie, and the code has no other way to
 * authenticate. So the dev server proxies `/v1` to a local `wrangler dev`.
 *
 * Run both: `npm run dev` here, `npm run dev -w quadra-server` next to it. With the Worker not
 * running, every API call fails as `offline` and the game still plays — unranked, which is the
 * behaviour worth being able to try on purpose.
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/v1': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
