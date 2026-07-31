# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) — with `1.0.0` reserved for online
multiplayer, per [ROADMAP.md](ROADMAP.md).

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
