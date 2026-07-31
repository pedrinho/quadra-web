# Quadra Web

A browser port of **Quadra**, the 1998 action puzzle game by **Ludus Design**.

This project exists for one reason: Quadra's **connectivity gravity**. Cleared lines don't
collapse row by row. Cells stay welded to the tetromino they arrived in, a line clear *severs*
those welds, and whatever is left unsupported falls as a **rigid body** — which can complete more
lines, cascading. No other Tetris-like plays quite the same.

**Version 0.5.0** — the solo game is complete and playable. `1.0.0` is reserved for online
multiplayer. See [ROADMAP.md](ROADMAP.md).

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
- [ ] Garbage and attacks — 0.6.0
- [ ] Multiplayer — 0.8.0 through 1.0.0

### Verified against the original

A position was captured from Quadra 1.3.0 with `QUADRA_DUMP=1`, before and after one move.
The real game reported Score 22000, Lines 8, one 8-line clear. The port reproduces it
exactly — chain 7, 8 lines, 22000 points, and the resulting board matching cell for cell
including which cells stay welded. `web/test/oracle.test.ts` asserts it, and that the
matching placement is the only one that produces that board.

## Running it

```sh
cd web
npm install
npm run dev       # play it
npm test          # 151 tests, headless
npm run typecheck
npm run demo      # watch a cascade resolve, frame by frame
```

Press `Esc` in the browser for key bindings, repeat speed and volume.

## Layout

```
web/src/engine/     the simulation — a port, kept faithful line by line
web/src/render/     indexed-palette framebuffer and board drawing
web/src/audio/      mixer, sample bank, event-to-sound mapping
web/src/input/      keyboard and DAS
web/public/assets/  the original art and sound, converted (see Licensing)
web/test/           151 tests, including fixtures captured from the real game
patches/            the one modification made to the upstream C++
docs/FIDELITY.md    hazards, deliberate divergences, regenerating from upstream
```

## Fidelity

The port follows the original's rules exactly rather than modernising them: no 7-bag, no hold
piece, no lock delay, no SRS kicks. That is deliberate — it means the native C++ build can be used
to check the port's behaviour, which is worth more than a slightly nicer feel.

Two things will bite anyone touching the engine — the LCG is **64-bit**, and a *clear* edge bit
means "welded". Both are written up, along with the handful of places this port knowingly departs
from the original, in **[docs/FIDELITY.md](docs/FIDELITY.md)**.
