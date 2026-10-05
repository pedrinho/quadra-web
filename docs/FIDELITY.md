# Fidelity

The port follows Quadra's rules exactly rather than modernising them: no 7-bag, no hold piece, no
lock delay, no SRS kicks. That is a deliberate choice, and it buys something specific — the
original binary stays usable as an oracle. Golden values are *generated* from the reference
implementation rather than assumed. A slightly nicer feel is not worth losing that.

---

## Hazards

Two things about this engine look wrong and are right. Both have cost real time.

### The LCG is 64-bit, not 32-bit

`seed = seed*0x41c64e6d + 0x00003039` in `source/random.cc:37-43`, where `seed` is a `time_t` —
**64-bit signed** on macOS and Linux. The multiply-accumulate happens in 64 bits and is narrowed
afterwards by `int(seed >> 10)`.

A `Math.imul` port looks entirely correct and produces a completely different piece sequence. It
is ported with `BigInt` in `web/src/engine/random.ts`; the golden vectors in
`web/test/random.test.ts` pin it.

Note that `crap_rnd` (legacy, `net_version < 23`) genuinely *does* truncate to int32 before
storing the seed. The two functions differ in width, and that is not a bug.

### A clear edge bit means "welded to an occupied neighbour"

Not "empty neighbour". The support flood fill relies on this and does **not** test occupancy, so
breaking the invariant makes support leak across empty space and silently disables gravity — the
board simply stops cascading, with nothing throwing. `assertWeldInvariant()` guards it in tests.

### Smaller ones

- **`calc_by`** (`source/player.cc:69-71`): `(((py+15+(12*18<<4))>>4)+17)/18`. Integer maths
  verbatim, never float. `y` is 1/16-px fixed point; one cell is `288`.
- **No lock delay.** The frame's gravity would collide and the piece welds. Don't add one.
- **Input is sampled at video-frame rate, not simulation rate** (`source/player.cc:299-304`), with
  three simulation frames of catch-up. DAS counters tick at render rate. Without that gate the
  feel is wrong.
- **The board is 36×18 with the border baked in** — playable columns 4..13, visible rows 12..31.
  Keep the offsets; do not re-index to 10×20.
- `fillBloc` is recursive in C++; it is an explicit stack in TypeScript.

## Where this deliberately differs

Two config-layer divergences, both in the `Esc` panel. Neither touches the simulation.

**Repeat sensitivity.** The original offers four presets — Slow / Normal / Fast / Faster — stored
as an index and switched into a frame delay in `Canvas::reinit`. This port takes a **0–100%
sensitivity** instead, mapped linearly onto the same delay range so all four original settings
stay exactly reachable (0% Slow, 50% Normal, 80% Fast, 100% Faster), with 80% the default.
Everything below that mapping is the original derivation unchanged — integer truncation and the
180 clamp included — and the delay stays an integer frame count, so the DAS loop still matches
`source/player.cc` line for line.

**Volume.** The original has no volume control at all, only a `-nosound` flag. The slider is an
addition. Sound itself is faithful: the original samples, the ten per-level themes, the pitch that
drops 256 units per cascade step, and the 8-voice limit that drops rather than steals, so a deep
chain thins out the way it always did. There is no music to port — the `cdmusic` setting is
vestigial from the DOS original and is read nowhere.

The simulation stays silent and pure: it queues plain event records, and the audio layer — which
owns its own randomness — decides how they sound. The original is equally careful, drawing every
sound wobble from the global RNG rather than the seeded game LCG. Reading the game LCG for audio
would shift the piece sequence.

---

## Working with upstream

The original C++ tree is **not** vendored here. It lives at
[quadra-game/quadra](https://github.com/quadra-game/quadra), and the port was made from tag
`v1.3.0`. Everything below needs a checkout of it:

```sh
git clone --branch v1.3.0 https://github.com/quadra-game/quadra ../quadra-upstream
```

Paths cited in comments throughout `web/src/` — `source/player.cc:762` and the like — refer to
that tree.

### Regenerating the assets

`web/public/assets/` is committed, because it is the only copy of the original art and sound in
this repository and the game cannot start without it. It only needs regenerating if the asset set
changes:

```sh
cd web
QUADRA_SRC=../../quadra-upstream npm run assets
```

Output is byte-reproducible; if `git status` is dirty afterwards, something changed.

The image and sound conversions happen at build time for the same underlying reason — the browser's own decoders
throw away exactly what the port needs:

- **Images.** Browsers decode paletted PNGs straight to RGBA and discard the indices, but the
  rendering model depends on them: block shading reads palette slots 184–255 (`Color::shade`,
  `source/color.cc:25-32`), and level changes and fades work by swapping the palette under fixed
  indices. `.qimg` keeps the indices and the palette separately.
- **Sound.** `decodeAudioData` resamples to the AudioContext's rate and discards the file's own
  rate. The original's pitch control *is* a rate ratio (`Playing_sfx`, `source/sound.cc:362-369`),
  so the source rate has to survive: `glissup.wav` is 22050 Hz and is played at 11000, an octave
  down. `.qsnd` keeps the raw 8-bit PCM and its rate, which lets `createBuffer` reproduce that
  exactly.

### Regenerating the test fixtures

`web/test/fixtures/*.dump` are real positions captured from the running C++ game. To capture more:

```sh
cd ../quadra-upstream
git apply ../quadra-web/patches/0001-dump-board-for-port.patch
./configure && make
QUADRA_DUMP=1 QUADRADIR=. ./quadra
```

The patch adds `dump_board_for_port()`, which prints the settled board as raw `block[]` bytes —
high nibble colour, low nibble exposed-edge mask. `web/test/dump.ts` parses that encoding
and `web/tools/import-dump.ts` replays a dumped position.

A screenshot is not a substitute: it shows colours but not which cells are welded to which, and
welding is precisely what decides how a cascade behaves.

### Regenerating the RNG vectors

`web/tools/oracle/rnd.cc` is self-contained — it re-declares the `Random` class inline and prints
golden vectors for five seeds. Compile and run it, and paste the output into
`web/test/random.test.ts`. It was generated with clang++ on arm64 macOS, where
`sizeof(time_t) == 8`; that matters, per the first hazard above.
