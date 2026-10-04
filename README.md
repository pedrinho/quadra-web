# Quadra Web

A browser port of **Quadra**, the 1998 action puzzle game by **Ludus Design**.

This project exists for one reason: Quadra's **connectivity gravity**. Cleared lines don't
collapse row by row. Cells stay welded to the tetromino they arrived in, a line clear *severs*
those welds, and whatever is left unsupported falls as a **rigid body** — which can complete more
lines, cascading. No other Tetris-like plays quite the same.

**Version 0.6.0** — the solo game is complete, hosted, and has a leaderboard that cannot be lied
to. `1.0.0` is reserved for online multiplayer. See [ROADMAP.md](ROADMAP.md).

---

## Credit

**Quadra was created by Ludus Design.** It was released as free software and maintained
thereafter by Pierre Phaneuf and contributors. All of the game design, the rules, the artwork and
the sound are theirs. This repository contains a translation of their work, not an original game.

| | |
|---|---|
| Original game | **Quadra**, by **Ludus Design** |
| Copyright | © 1998–2000 Ludus Design |
| | © 2006 Pierre Phaneuf and contributors |
| Upstream source | **https://github.com/quadra-game/quadra** |
| Ported from | Quadra 1.3.0 (tag [`v1.3.0`](https://github.com/quadra-game/quadra/tree/v1.3.0)) |
| License | GNU Lesser General Public License, version 2.1 or later |

**This project is not affiliated with or endorsed by Ludus Design.**

If you want to play the game as it was made — with its full multiplayer, its menus and its
history — go get it from upstream. It still builds and it is still excellent.

## Licensing

Quadra is licensed under the **GNU LGPL v2.1 or later**. Translating its source from C++ to
TypeScript produces, under copyright law, a derivative work — so this port carries the **same
licence**, LGPL-2.1-or-later. The full text is in [`LICENSE`](LICENSE) and must stay with any copy
or fork.

**The artwork and sound are Ludus Design's.** `web/public/assets/` holds the original backgrounds
and sound samples, converted into two formats the browser can load without destroying what the
port needs (see [docs/FIDELITY.md](docs/FIDELITY.md) for why the conversion is necessary at all).
They are format conversions of someone else's assets, redistributed under the same licence — not
original work of this project. They are regenerable from an upstream checkout; nothing in them
is invented here.

**Ported files cite their origin.** Roughly 120 comments across `web/src/` name the original file
and line a behaviour came from — `web/src/engine/random.ts:2` cites `source/random.cc`,
`web/src/audio/mixer.ts:20` cites `source/sound.cc:33`, and so on. Those paths refer to **upstream
Quadra 1.3.0**, not to files in this repository. Please keep them intact: they are both the licence
trail and the map back to the reference implementation.

**Changes to the original**, as the LGPL requires be stated: one, a debug board dump used to
transfer real in-game positions into the port. It is preserved as
[`patches/0001-dump-board-for-port.patch`](patches/0001-dump-board-for-port.patch). Nothing else
upstream was modified.

---

## Status

Playable. The engine was ported and verified headlessly before any rendering existed.

- [x] LCG — bit-exact with the original, verified against the compiled C++
- [x] Piece tables and the exposed-edge encoding
- [x] Board geometry and collision
- [x] The cascade: weld severing, group support, rigid-body fall
- [x] Module/Executor coroutine scheduler
- [x] Piece movement, rotation, the single-nudge wall kick, DAS
- [x] Gravity, stamping, scoring, levels
- [x] Fixed 100 Hz loop with backlog skipping
- [x] Rendering — indexed framebuffer, original 18px bevelled art, real backgrounds
- [x] Browser input and a playable game shell
- [x] Validated against the original on a real captured position
- [x] Configurable keys and repeat sensitivity, persisted in the browser
- [x] Sound — the original samples, per-level themes, and the 8-voice mixer policy
- [x] Recordings: the tape format, the recorder, playback, and a verifier for hostile input
- [x] Hosted, with accounts, server-issued seeds and a leaderboard of watchable replays
- [ ] Garbage and attacks — 0.7.0
- [ ] Multiplayer — 0.9.0 through 1.0.0

### Verified against the original

A position was captured from Quadra 1.3.0 with `QUADRA_DUMP=1`, before and after one move.
The real game reported Score 22000, Lines 8, one 8-line clear. The port reproduces it
exactly — chain 7, 8 lines, 22000 points, and the resulting board matching cell for cell
including which cells stay welded. `web/test/oracle.test.ts` asserts it, and that the
matching placement is the only one that produces that board.

## The board

A score submitted by a client is worthless — anyone can POST a number. So nothing here submits a
score. What a finished game sends is the **recording**: the keys that were pressed and the frames
they were pressed on. The server re-simulates it with the *same engine module the browser ran*,
imported rather than reimplemented, and the number that comes out of that is the only one the
leaderboard ever stores.

Which means every row on the board is a replay, because it is literally the same artifact — and
the *Verify* control beside each row will fetch it and re-run it in your browser, in front of you,
and tell you what it got. If your machine and the server ever disagree, it says so.

Two things this deliberately does **not** claim. Verification proves that *these inputs, on this
seed, produce this score* — not that a human produced the inputs. And the seed is issued by the
server for one game and one player, which stops a run being restarted until the pieces fall kindly
and stops a good tape being submitted twice, but a determined bot playing honestly will still get
through. That is an accepted limit of the design rather than an oversight.

You can play without an account. Nothing is recorded when you do — there is no local board, and
the run is gone when it ends.

## Running it

```sh
npm install
npm run dev       # play it, at localhost:5173
npm test          # both workspaces, headless
npm run typecheck
npm run demo -w quadra-web    # watch a cascade resolve, frame by frame
```

Press `Esc` in the browser for key bindings, repeat speed and volume.

The game runs on its own. For the board, the accounts and the replays, run the Worker beside it —
the dev server proxies `/v1` to it, so the session cookie stays first-party the way it is in
production:

```sh
npm run dev -w quadra-server    # the API, at localhost:8787
```

That applies the migrations to the local database before starting, so a fresh checkout works
without a setup step.

Signing in needs one of two things in `server/.dev.vars` (gitignored):

```sh
# Google, with a client of your own whose redirect URIs include
# http://localhost:8787/v1/auth/google/callback and http://localhost:5173/v1/auth/google/callback
GOOGLE_CLIENT_ID=….apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…

# and/or e-mail and password, which needs no account anywhere
PASSWORD_LOGIN=on
```

With no mail provider configured the confirmation and reset links are **printed to the Worker's
console** instead of being sent, so registering end to end needs no mailbox. Without the Worker
running at all, every request fails as unreachable and the game still starts, plays and finishes —
unranked, and it says so.

### Deploying it

One Worker serves the built site and the API from the same origin, and it fits Cloudflare's free
plan. Two things make that true, and both are easy to undo by accident:

- **Runs are replayed in a Durable Object, not in the request.** A free-plan request gets 10 ms of
  CPU and replaying a ten-minute run costs about thirty; a Durable Object gets 30 s. See
  `server/src/verifier.ts`.
- **Players sign in with Google.** E-mail and password accounts are off (`PASSWORD_LOGIN` is
  unset) because there is no mail to confirm them with, and because a password hash costs more
  than the request has. Production Workers also refuse PBKDF2 above 100,000 iterations, which
  the local runtime does not enforce — `server/test/password.test.ts` is what notices.

Once, by hand:

1. A Cloudflare account, with a `workers.dev` subdomain chosen. R2 asks for a payment method even
   on the free tier; nothing is charged within it. Then `npx wrangler login`.
2. `npx wrangler d1 create quadra` — put the id in `server/wrangler.toml` — and
   `npx wrangler r2 bucket create quadra-tapes`.
3. A Google OAuth client, at [console.cloud.google.com](https://console.cloud.google.com), in a
   project of its own (no billing needed):
   - *Branding*: a name and the two contact addresses. **No logo** — a logo sends the app to
     Google for review.
   - *Data access*: `openid`, `email`, `profile` and nothing else. With only those, Google does
     not review the app and shows no warning.
   - *Audience*: External, then **Publish app**. Until then only listed test users can sign in.
   - *Clients*: a Web application, with `https://quadra.<subdomain>.workers.dev/v1/auth/google/callback`
     as a redirect URI (and the two localhost ones above, for development).
   - Its client id goes in `server/wrangler.toml` as `GOOGLE_CLIENT_ID`, along with the real
     `PUBLIC_ORIGIN`. The secret goes in with `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
4. `npx wrangler d1 migrations apply quadra --remote`, from `server/`.

Then `npm run deploy`, or push to `main` and let `.github/workflows/deploy.yml` do it.
Workers Logs is on (`[observability]`), and is where to look when a request fails for someone
else: what the Worker printed, and how much CPU each request took.

## Layout

```
web/src/engine/     the simulation — a port, kept faithful line by line
web/src/render/     indexed-palette framebuffer and board drawing
web/src/replay/     the tape format, the recorder, playback, and the verifier
web/src/audio/      mixer, sample bank, event-to-sound mapping
web/src/input/      keyboard and DAS
web/src/ui/         the page's own controls: the board, the panels, the stage
web/public/assets/  the original art and sound, converted (see Licensing)
web/test/           tests, including fixtures captured from the real game
server/src/         the Worker: accounts, seed grants, submission, the board
server/migrations/  the D1 schema
patches/            the one modification made to the upstream C++
docs/FIDELITY.md    hazards, deliberate divergences, regenerating from upstream
```

`server/` imports `verify` from `web/` through an exports map rather than vendoring a copy. That
is the whole guarantee: there is no second engine that could quietly disagree with the first. Both
suites pin the same score for the same committed recording, from opposite sides, so an engine that
is only nearly the same fails a test instead of certifying scores.

## Fidelity

The port follows the original's rules exactly rather than modernising them: no 7-bag, no hold
piece, no lock delay, no SRS kicks. That is deliberate — it means the native C++ build can be used
to check the port's behaviour, which is worth more than a slightly nicer feel.

Two things will bite anyone touching the engine — the LCG is **64-bit**, and a *clear* edge bit
means "welded". Both are written up, along with the handful of places this port knowingly departs
from the original, in **[docs/FIDELITY.md](docs/FIDELITY.md)**.
