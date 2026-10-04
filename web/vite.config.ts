import { fileURLToPath } from 'node:url';
import { createLogger, defineConfig, type ProxyOptions } from 'vite';

const API = 'http://localhost:8787';

/*
 * In production one Worker serves both this site and the API, so `/v1` is same-origin and the
 * session cookie is first-party. `vite dev` has to reproduce that or nothing signed-in works: a
 * cross-origin request would not carry the cookie, and the code has no other way to authenticate.
 * So the dev server proxies `/v1` to a local `wrangler dev`.
 *
 * The game does not need it. With the Worker down every call fails as unreachable and the page
 * says so, which is behaviour worth being able to try on purpose — but it is *also* what you get
 * by forgetting to start the Worker, and the two are identical from the browser. So the proxy
 * says which it is, once, instead of leaving a page that merely seems broken.
 */
const api: ProxyOptions = {
  target: API,
  changeOrigin: false,
  configure(proxy) {
    let quiet = false;
    proxy.on('error', (err, _req, res) => {
      if (!quiet) {
        quiet = true;
        const refused = (err as NodeJS.ErrnoException).code === 'ECONNREFUSED';
        console.log(
          refused
            ? `\n  The API is not running, so the board, accounts and replays are unavailable.\n` +
                `  Start it next to this:  npm run dev -w quadra-server\n` +
                `  The game plays without it — runs simply will not count.\n`
            : `\n  Proxy error talking to ${API}: ${err.message}\n`,
        );
      }
      // Answer the way the API would if it were up and failing, so the client takes its own
      // unreachable path instead of parsing a proxy's HTML.
      if ('writeHead' in res && !res.headersSent) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'unavailable' }));
      } else {
        res.destroy();
      }
    });
    // Say it again if the Worker comes back and goes away again, rather than staying quiet.
    proxy.on('proxyRes', () => {
      quiet = false;
    });
  },
};

/*
 * Vite attaches its own proxy error handler after this config is applied, and it prints a
 * connection-refused stack trace per request — three of them before the page has finished
 * loading. There is no hook to replace it, so the noise is dropped at the logger. Only that one
 * message, and only when it is the API being absent; everything else still reaches the terminal.
 */
const logger = createLogger();
const inherited = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (msg.includes('http proxy error') && msg.includes('ECONNREFUSED')) return;
  inherited(msg, options);
};

/*
 * Two documents, not one: the stage at `/` and the board at `/records`. A board is a thing you
 * link someone to, and a section of a scrolling page cannot be linked, reloaded into, or served
 * without the game loading behind it.
 *
 * Workers Assets serves `records.html` at `/records` on its own, so this is the only place the
 * second page needs declaring.
 */
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  customLogger: logger,
  server: { port: 5173, proxy: { '/v1': api } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { main: page('index.html'), records: page('records.html') } },
  },
});
