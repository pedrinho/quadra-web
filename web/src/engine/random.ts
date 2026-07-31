/*
 * Port of source/random.cc from Quadra.
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 */

const MUL = 0x41c64e6dn;
const INC = 0x3039n;

/**
 * Quadra's LCG, bit-exact with the C++ original.
 *
 * The state is `time_t seed`, which is **64-bit signed** on macOS and Linux, so the
 * multiply-accumulate happens in 64 bits and only *then* gets narrowed. Implementing this
 * as a 32-bit LCG (the obvious guess) produces a different piece stream. Signed overflow
 * is formally UB in C++ but wraps two's-complement on every real compiler, which is what
 * `BigInt.asIntN(64, ...)` reproduces.
 *
 * Each Canvas owns one of these, seeded from the shared game seed, which is how every
 * client derives an identical piece sequence without sending pieces over the wire.
 */
export class Random {
  private seed: bigint;

  constructor(seed: number | bigint = 0) {
    this.seed = BigInt.asIntN(64, BigInt(seed));
  }

  getSeed(): bigint {
    return this.seed;
  }

  setSeed(seed: number | bigint): void {
    this.seed = BigInt.asIntN(64, BigInt(seed));
  }

  /**
   * `Random::rnd` — source/random.cc:37-43. The one used for piece selection
   * (net_version >= 23, i.e. everything we care about).
   */
  rnd(and = 0xffff): number {
    this.seed = BigInt.asIntN(64, this.seed * MUL + INC);
    // `int(seed >> 10)`: arithmetic shift on the signed 64-bit value, then truncate to int32.
    const tmp = BigInt.asIntN(32, this.seed >> 10n);
    return Number(BigInt.asUintN(16, tmp & BigInt(and)));
  }

  /**
   * `Random::crap_rnd` — source/random.cc:45-51. Legacy path for net_version < 23.
   * Note the difference: it truncates to int32 *before* storing back to the seed, so the
   * state stays effectively 32-bit (sign-extended on assignment to time_t).
   */
  crapRnd(and = 0xffff): number {
    const tmp = BigInt.asIntN(32, this.seed * MUL + INC);
    this.seed = BigInt.asIntN(64, tmp >> 10n);
    return Number(BigInt.asUintN(16, tmp & BigInt(and)));
  }
}
