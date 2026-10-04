# Roadmap

**1.0.0 means playing Quadra against other people, from a URL, in a browser.** Everything below
is the road to that. Versions before 1.0 are milestones on it, not stability promises.

The order is deliberate: every versus rule is built and tested locally before any of it has to
survive a network. Netcode is hard enough without also debugging attack routing.

---

### 0.5.0 — solo game complete ✅

*Released.* Engine, cascade, rendering, input, sound, configuration. Verified against the
original C++ on a real captured position, bit-exact RNG, 151 tests.

### 0.6.0 — Quadra online, single player

Hosted, with a leaderboard that cannot be lied to.

The load-bearing idea is that **the leaderboard entry and the replay are the same artifact.** A
score a client sends is worthless — anyone can POST a number — so the client submits the *input
recording* and the server re-simulates it with the same engine module the browser ran. That
recording is exactly what a replay is, and per 0.9.0 below it is also the netcode wire format, so
one piece of work pays for three features.

- Tape format, recorder, playback, and a verifier written for hostile input
- A guard that fails the build when `src/engine/` changes without someone deciding what that
  means for stored recordings
- One Cloudflare Worker serving both the site and the API, on D1 and R2, within the free plan —
  runs are replayed in a Durable Object, which has the CPU a request does not
- Sign in with Google, or by e-mail and password where the deployment can send mail; **a guest
  can play, and nothing is kept**
- Server-issued seeds, so a ranked run cannot be restarted until the pieces fall kindly
- Every row on the board watchable, and verifiable in the browser against the server's score

### 0.7.0 — garbage and attacks

The versus rules, exercised in single player before any opponent exists.

- The attack table and how clears translate into lines sent
- The potato, and bonus/malus effects
- Lines pushed up from below, and what that does to welds and to a cascade already in flight
- Target selection rules
- Fixtures captured from the original to pin the numbers, as with the cascade

### 0.8.0 — AI opponents and local versus

Proves the versus plumbing with no network involved.

- Several boards rendered at once, at the original's scaled-down sizes
- Attacks routed between them
- A CPU player good enough to be worth playing
- Hot-seat / shared-keyboard play

### 0.9.0 — netcode

- An authoritative server running the same engine module stack as the client
- The fixed 100 Hz deterministic simulation is what makes this tractable: same seed and same
  inputs give the same board, so the wire only has to carry inputs
- Transport is **WebSocket**. Quadra's 1998 TCP/UDP protocol, its packet catalogue and the Perl
  Qserv metaserver are **not** being ported — the constraints they were designed around no
  longer exist
- Lag compensation, reconnection, and desync detection against the server's board hash

### 0.10.0 — lobby

- Matchmaking and rooms
- Chat
- Spectating
- Reconnecting into a game in progress

### 1.0.0 — online multiplayer

Open a URL, get matched, play. Hosted, stable, and faithful enough that someone who played
Quadra in 2001 recognises it immediately.

---

## Not planned

- **Modernised rules.** No 7-bag, no hold piece, no lock delay, no SRS. The whole approach
  depends on the original binary being usable as an oracle, and that stops working the moment the
  rules drift. See [docs/FIDELITY.md](docs/FIDELITY.md).
- **Porting the original's menu system.** The port has its own shell. The game is the point.
- **The `.res` WAD reader.** The loose asset trees upstream are byte-identical to the WAD
  contents, so there is nothing to gain.
