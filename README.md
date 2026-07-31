# Quadra Web

A browser port of **Quadra**, the 1998 action puzzle game by Ludus Design.

This project exists for one reason: Quadra's **connectivity gravity**. Cleared lines don't
collapse row by row. Cells stay welded to the tetromino they arrived in, a line clear *severs*
those welds, and whatever is left unsupported falls as a **rigid body** — which can complete more
lines, cascading. No other Tetris-like plays quite the same.

---

## Credit and licensing

This is a derivative work. **Quadra was created by Ludus Design**, released as free software, and
maintained thereafter by Pierre Phaneuf and contributors.

| | |
|---|---|
| Original game | Quadra |
| Copyright | © 1998–2000 Ludus Design |
| | © 2006 Pierre Phaneuf and contributors |
| Upstream | https://github.com/quadra-game/quadra |
| License | GNU Lesser General Public License, version 2.1 or later |

Quadra is licensed under the **GNU LGPL v2.1 or later**. Porting its source from C++ to
TypeScript produces a *translation*, which under copyright law is a derivative work — so this
port is licensed under the **same terms**, LGPL-2.1-or-later. The full license text is in
[`LICENSE`](LICENSE) and must stay with any copy or fork.

Ported files carry a header naming the original source file they derive from. Please keep those
headers intact; they are both the license obligation and the map back to the reference
implementation.

The original C++ source, artwork, sounds, fonts and text are included under the same license, and
the upstream build instructions are preserved in [`UPSTREAM-README.md`](UPSTREAM-README.md).

Changes made to the upstream source, as the LGPL requires be stated:

- `source/player.cc` — added `dump_board_for_port()`, a debug board dump used to transfer real
  in-game positions to the port. Off unless `QUADRA_DUMP=1` is set, and writes only to stdout.

Everything else is upstream 1.3.0 as released; the pristine tree is the first commit in this
repository's history.

**This project is not affiliated with or endorsed by Ludus Design.**

---

## What this repository contains

```
source/  images/  sons/  fonts/  textes/  demos/   the original C++ game, unmodified
web/                                               the TypeScript browser port
```

The C++ tree is deliberately left buildable. It is the reference implementation, and it doubles
as a test oracle — golden values are generated from it rather than assumed.

## Status

Early. The engine is being ported before any rendering exists, so the mechanic can be verified
headlessly.

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
- [ ] Garbage and attacks
- [ ] Multiplayer

It is playable in a browser: `npm run dev`. `npm run demo` drives a cascade through the
real module stack and prints it frame by frame.

### Verified against the original

A position was captured from Quadra 1.3.0 with `QUADRA_DUMP=1`, before and after one move.
The real game reported Score 22000, Lines 8, one 8-line clear. The port reproduces it
exactly — chain 7, 8 lines, 22000 points, and the resulting board matching cell for cell
including which cells stay welded. `web/test/oracle.test.ts` asserts it, and that the
matching placement is the only one that produces that board.

Design decisions, the mechanic written out in full, and the known fidelity hazards are recorded
in the project plan.

## Working on it

```sh
cd web
npm install
npm test          # 82 engine tests, headless
npm run typecheck
npm run demo      # watch a cascade resolve, frame by frame
npm run dev       # not useful yet — no renderer
```

### Fidelity

The port follows the original's rules exactly rather than modernising them: no 7-bag, no hold
piece, no lock delay, no SRS kicks. That is a deliberate choice — it means the native build can be
used to check the port's behaviour, which is worth more than a slightly nicer feel.

Two hazards worth knowing before touching the engine:

- **The LCG is 64-bit, not 32-bit.** `seed` is a `time_t` (`source/random.h:27`), so the
  multiply-accumulate happens in 64 bits and is narrowed afterwards. A `Math.imul` port looks
  right and produces a completely different piece sequence. Golden vectors in
  `web/test/random.test.ts` pin it; regenerate them with `web/tools/oracle/rnd.cc`.
- **A clear edge bit means "welded to an occupied neighbour".** The support flood fill relies on
  it and does not test occupancy, so breaking the invariant makes support leak across empty space
  and silently disables gravity. `assertWeldInvariant()` guards it in tests.
