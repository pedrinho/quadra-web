# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) — with `1.0.0` reserved for online
multiplayer, per [ROADMAP.md](ROADMAP.md).

## [Unreleased] — 0.6.0

Quadra is online. The solo game is unchanged; what is new is everywhere it now goes.

### Added

- **The tape.** A recording of a run — the keys pressed and the frames they were pressed on, one
  record per rendered frame. `web/src/replay/`: the byte format, the recorder, playback, a state
  hasher and a verifier written for input that is assumed hostile. It never throws, it bounds its
  own work before doing any, and it decodes as it streams.
- **A guard on the simulation.** `web/test/engine-version.test.ts` fails whenever `src/engine/`
  changes, printing the digest to paste in, so the question — *can this alter the outcome of a
  game?* — is answered out loud rather than skipped. It also refuses any reference to the DOM
  there, which is what lets the server run the same code.
- **The service.** One Cloudflare Worker serving both the site and the API from the same origin,
  on D1 and R2. `server/`. It fits the free plan: a submitted run is replayed in a Durable Object
  (`server/src/verifier.ts`), which is allowed 30 s of CPU where the request is allowed 10 ms —
  and a ten-minute run costs about thirty.
- **An unlisted alpha.** `robots.txt` and an `X-Robots-Tag` header keep it out of search engines
  until it is announced.
- **Sign in with Google.** No password and no mail: Google has already confirmed the address,
  and a first sign-in asks only for the name that goes on the board — never the real one Google
  knows. The authorization-code flow with PKCE, by hand, in `server/src/google.ts`. An existing
  password account with the same address is joined rather than duplicated; if it never confirmed
  that address, its password is removed on the way, so registering somebody else's address and
  waiting for them is not a way into their account.
- **Accounts**, by e-mail and password: registration with a confirmation link, sign in, password
  reset, and closing an account. Off unless `PASSWORD_LOGIN` is `on`, because a deployment with no
  mail could never confirm one; the page offers whichever ways in the server says it has.
  Passwords are PBKDF2-HMAC-SHA256 at 100,000 iterations — the most production Workers will
  derive, and a ceiling the local runtime does not enforce, so a test pins it — with the count
  stored in the hash so it can be raised later. Sessions are opaque tokens in an HttpOnly cookie,
  stored only as their digest, so signing out takes effect at once.
- **A leaderboard that cannot be lied to.** Nothing submits a score: a finished game submits its
  recording, and the server derives the score by re-simulating it with the client's own engine —
  imported, not reimplemented. Every row is therefore watchable: pressing *Watch* replays the
  recording on the board beside the list, through the engine the game is played with.
- **Server-issued seeds.** A ranked run asks for its seed first, bound to one player and one
  game. Restarting until the pieces fall kindly, submitting a run twice, and submitting somebody
  else's all stop working.
- **Floating score and "Clean Canvas!!" text**, as the original raises them: `Double!/Triple!/
  Quad!/N-lines! N pts` at the erase's end and the clean-board announcement at the erase itself,
  rising two pixels per tick up the well.
- **A dev-server proxy** so `/v1` is same-origin in development too, and a deploy workflow gated
  behind CI.
- **Watching the 1998 game's own recordings.** The board page opens a `.rec` — the format the
  original wrote — and replays it. It is not converted into a tape and can never reach the
  leaderboard: a tape is this simulation's proof of a score, and one minted from somebody else's
  1998 file would be a claim this engine never made. It is only ever watched.

  `Buk14clean.rec`, which ships with Quadra, replays here to **362179 points, 149 lines and
  level 10** — the numbers written in its own trailer, recomputed from nothing but the seed and
  27832 frames of keystrokes. That is a stronger statement than the oracle tests can make: it is
  a stranger's run, recorded in 2000 by a program none of us has run, and the port reaches it
  exactly. `web/test/rec.test.ts` pins it.

  Playing one needs the rules the original gated on `net_version` below 23 (`web/src/engine/
  net-version.ts`): the piece stream is drawn with `crap_rnd`, the cascade bonus is linear, the
  clean bonus is a flat 5000 paid at the erase, and placing a piece quickly is worth up to 75
  points — including the unsigned-underflow in `player.cc:484-490` that makes the cap 75 rather
  than the 50 the code appears to promise. All of it is behind the version check, so `SIM_VERSION`
  did not move and no stored recording did either.

  Only the older single-player form plays. Seventeen of the eighteen demos upstream are in the
  netcode packet format later versions recorded everything through — including solo runs, so the
  refusal says "packet format", not "multiplayer".

### Changed

- The repository is an npm workspace: `web/` and `server/`, installed and checked together.
- `verify` reports `pausedTicks`. Pausing gates input but not the clock, so it was unlimited free
  time to think; a ranked run may now be paused for a minute plus a quarter of the time played.
- The backdrops load lazily. Only the first level's is on the critical path, instead of 3 MB of
  them in front of the first piece.
- Both test suites pin the same score for the same committed recording, from opposite sides.
- **The board is its own page**, at `/records`, instead of a section you scroll past on the way
  down the stage. A board is a thing you link someone to, and a section could not be linked,
  reloaded into, or opened without the game loading behind it. The site is two documents now, so
  a path matching no asset is a 404 rather than the home page with a 200. What both pages share —
  the masthead artwork, the identity, the audio, the settings, the backdrops — is in `web/src/
  shell.ts`; a finished run reaches its row through `/records?fresh=<id>`.
- **One row per player on the board.** `/records` shows each player's best run, so a name is on
  it once however often its owner plays. Every run — the board as it used to be — has a page of
  its own, **Player highscores**, at `/player-highscores`. `GET /v1/leaderboard` takes
  `each=player`, the default, or `each=run`. A finished run is told where it landed: its player's
  place on the board when it is their new best, and otherwise its place among every run, with the
  link going to the page the row is actually on. A closed account's runs keep a row each, because
  nothing left says they were one person's.
- **The playfield is part of that page**, held on the left while the rows scroll past it on the
  right, with the transport under it. Watching a run used to take the whole window: the board
  appeared in a dimmed, blurred layer over the list it came from, so the row being watched, and
  every row near it, was unreadable while it played. Narrow enough and the two stack, with the
  board pinned under the masthead instead.
- **The site is an app now, laid out like chess.com.** A menu fixed on the left, the board fixed
  in the middle, and a panel on the right that changes with what you are doing: Play, the
  leaderboard, About, or your score and controls while you play. Moving between them never
  reloads, so the board keeps its pixels and a game in progress survives it (leaving Play pauses
  it). Watching a run plays it on that same board, with the transport underneath, instead of in a
  window of its own. Nothing scrolls on a laptop; the panel scrolls inside itself when it has to.
  `/records`, `/player-highscores` and the new `/about` are still real addresses, each the same
  app opened at a different view (`src/shell.html`, spliced in by a Vite plugin).
- **The page stops borrowing the 1998 artwork.** It was built out of cut-outs — a logo cropped
  from the menu screen that read "OUADRA", the yellow menu label as the Play button, two
  photographs as wallpaper — in five unrelated type styles. The artwork lives on the board only.
  Around it: a dark, quiet ground; two faces with two jobs, Sofia Sans Extra Condensed for titles
  and Sofia Sans for everything else, replacing IBM Plex; drawn icons instead of glyphs from
  whatever fallback font a system had; and copy written for someone who has not played yet. The
  board grows to 1.5× on a 2× display — still a whole number of device pixels per source pixel —
  so a laptop gets a 608px board instead of a 405px one.
- **Nothing covers the board when a run ends or pauses.** A dimmed, blurred layer used to go over
  it, with the score in large type — the third copy of it on screen — hiding the death wipe and
  the original's pause badge. What became of the run is now a line under the score in the panel,
  with the link to its row; the heading reads "Final score" and Restart becomes **Play again**.
  A verdict that comes back after another game has started is no longer shown over that one, and
  no longer takes away its ranking either: the grant was cleared only once the answer arrived,
  by which time it could be the new game's.

### Removed

- **The local leaderboard.** Scores lived in `localStorage` under `quadra.runs.v1`; there is one
  board now and it is the online one. A guest can still play, and nothing is kept when they do.
- **Artwork nothing draws any more**: the menu screens, lettering and photographs the page was
  once cut out of (`black`, `debuto`, `debut0/3/8`, `hscore`, `multi`), and the `courrier` face —
  1.3 MB of every deployment. They are still regenerable from upstream.
- The recordings only the tests read (`chain9`, `clean8/10/12`) moved to `web/test/fixtures/`,
  and the C++ board-dump parser moved out of `src/engine/` into the tests, the only place it is
  used. `replay/codec.ts` (base64 for a tape) went with the last thing that sent one as text.

### Fixed

- **Sound when a run is watched.** A replay queues sound exactly as live play does — it is the
  same simulation — but neither the viewer nor the attract loop ever drained the queue, so every
  recording on the board played silently, and the queue grew for every tick nobody listened to.
  The viewer now has sound and a mute control beside the speed, over the one volume setting there
  is. Seeking stays silent: `TapePlayer.seek` re-simulates, so the queue after a scrub holds
  every event it passed over, and playing that fires a whole run at one instant. The attract loop
  stays silent by choice — it starts before anyone has touched the page — but no longer
  accumulates.
- **The line-clear flash.** The port had the sixteen frames the original spends flashing a cleared
  row, and the sound that goes with them, but drew nothing in them — so a clear read as the rows
  vanishing, a pause with the stack hanging in mid-air, and then the fall. `Canvas` now carries
  `flash` and `colorFlash` as the original does, and the renderer paints the solid bars:
  white for two frames, red for two, four times over. Presentation only — the simulation writes
  them and never reads them back, so no game's outcome changes, no frame count moves and every
  recording made before this still verifies to the same score and the same state hash.
- **The death wipe.** Topping out in the original recolours the stack over a second, a cell every
  other tick in each quadrant — outer columns first, each one closing from the top and bottom
  edges toward the middle row — with a sample as each column finishes. The port reduced that to
  the game simply stopping and one beep. `web/src/render/death-sweep.ts` ports `Player_dead::step`'s
  order and timing, and the live game, the replay viewer and the attract loop all play it. It
  stays out of the engine on purpose: the game still ends on the tick it always did, so tapes,
  state hashes and the verifier are untouched.

## [0.5.0] — 2026-07-31

First tagged release. The solo game is complete and playable in a browser.

### Added

- **Engine.** A faithful port of Quadra's simulation from C++ to TypeScript: the 64-bit LCG,
  piece tables and the exposed-edge encoding, board geometry and collision, gravity, stamping,
  scoring and levels.
- **The cascade.** Weld severing on a line clear, group support flood fill, and rigid-body fall —
  the mechanic the whole project exists for.
- **Module/Executor scheduler.** The original's coroutine-style player module stack, ported
  rather than reinterpreted, on a fixed 100 Hz loop with backlog skipping.
- **Rendering.** An indexed-palette framebuffer with the original 18px bevelled block art and the
  real per-level backgrounds, drawn from the original palettes.
- **Input.** Keyboard handling with the original's single-nudge wall kick and DAS, sampled at
  video-frame rate as the original does.
- **Sound.** The original samples, the ten per-level themes, the pitch that drops 256 units per
  cascade step, and the 8-voice mixer policy that drops rather than steals voices.
- **Settings.** Configurable key bindings, repeat sensitivity and volume, persisted in the
  browser.
- **Validation against the original.** A real position captured from Quadra 1.3.0 with
  `QUADRA_DUMP=1`; the port reproduces its chain 7 / 8 lines / 22000 points result cell for cell,
  welds included. Golden RNG vectors generated from the compiled C++ pin the LCG.
- 151 tests, all headless.

### Changed

- The upstream C++ tree is **no longer vendored** in this repository. The port ships the original
  art and sound as converted assets under `web/public/assets/` instead, which is all it needs to
  run; the reference implementation lives at
  [quadra-game/quadra](https://github.com/quadra-game/quadra). See
  [docs/FIDELITY.md](docs/FIDELITY.md) to regenerate assets or test fixtures from an upstream
  checkout.
- Repeat sensitivity is exposed as **0–100%** rather than the original's four presets, mapped
  linearly onto the same frame-delay range so all four original settings stay exactly reachable.
  A config-layer difference only; the simulation it feeds is unchanged.

[0.5.0]: https://github.com/pedrinho/quadra-web/releases/tag/v0.5.0
