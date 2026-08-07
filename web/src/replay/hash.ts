/*
 * Fingerprints of simulation state, for replay integrity and desync detection.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Two interleaved FNV-1a lanes with different bases and different multipliers, concatenated
 * into 64 bits. Pure 32-bit integer work via Math.imul — no BigInt in the loop, and the same
 * digest on every JS engine.
 *
 * This is deliberately *not* cryptographic and must not be "upgraded" to SHA-256 for imagined
 * security. It is a cheap equality check between two parties who both hold the state. A server
 * that doubts a tape does not compare hashes harder — it re-runs the tape.
 */

import { PLAY_LEFT, PLAY_RIGHT, PLAY_BOTTOM, idx, type Board } from '../engine/board.js';
import type { Canvas } from '../engine/canvas.js';
import type { Game } from '../engine/game.js';
import type { Bloc } from '../engine/bloc.js';

const FNV_PRIME = 0x01000193;
const GOLDEN = 0x9e3779b1;

export class Hasher {
  private a = 0x811c9dc5 | 0;
  private b = 0x9dc5811c | 0;

  byte(v: number): this {
    const x = v & 0xff;
    this.a = Math.imul(this.a ^ x, FNV_PRIME);
    this.b = Math.imul(this.b ^ x, GOLDEN);
    return this;
  }

  /** Little-endian, so the digest does not depend on the host's word order. */
  u32(v: number): this {
    return this.byte(v).byte(v >>> 8).byte(v >>> 16).byte(v >>> 24);
  }

  /** Numbers that are conceptually integers but typed as `number`. Fractions would be lost,
   *  so this asserts rather than silently truncating — a fractional clock is a bug. */
  int(v: number): this {
    if (!Number.isInteger(v)) throw new Error(`hash: expected an integer, got ${v}`);
    return this.u32(v | 0).u32(Math.floor(v / 0x100000000));
  }

  bool(v: boolean): this {
    return this.byte(v ? 1 : 0);
  }

  bigint64(v: bigint): this {
    const u = BigInt.asUintN(64, v);
    return this.u32(Number(u & 0xffffffffn)).u32(Number((u >> 32n) & 0xffffffffn));
  }

  bytes(src: Uint8Array, from: number, to: number): this {
    for (let i = from; i < to; i++) this.byte(src[i]!);
    return this;
  }

  /** The two lanes, for embedding in a binary format. */
  lanes(): [number, number] {
    return [this.a >>> 0, this.b >>> 0];
  }

  digest(): string {
    const [a, b] = this.lanes();
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
}

export const digestOf = (lanes: readonly [number, number]): string =>
  lanes[0].toString(16).padStart(8, '0') + lanes[1].toString(16).padStart(8, '0');

/**
 * The settled playfield.
 *
 * Rows 0..PLAY_BOTTOM, so the hidden spawn buffer is included — what sits up there decides
 * collision and top-out. The walls and floor are constant and excluded.
 *
 * `block` is hashed as well as `occupied`, and that is the point: its low nibble is the
 * exposed-edge mask, which is to say the welds. Two boards with identical occupancy and
 * different welds cascade completely differently, so a hash over occupancy alone would call
 * them equal. Same argument test/oracle.test.ts makes for comparing rendered boards rather
 * than scores.
 */
export function hashBoardInto(h: Hasher, b: Board): Hasher {
  for (let row = 0; row < PLAY_BOTTOM; row++) {
    const base = idx(row, 0);
    for (let col = PLAY_LEFT; col < PLAY_RIGHT; col++) {
      h.byte(b.occupied[base + col]!).byte(b.block[base + col]!).byte(b.blinded[base + col]!);
    }
  }
  return h;
}

export function boardHash(b: Board): string {
  return hashBoardInto(new Hasher(), b).digest();
}

function hashBloc(h: Hasher, p: Bloc | null): void {
  if (!p) {
    h.byte(0xff);
    return;
  }
  h.byte(1).byte(p.quel).byte(p.col).byte(p.rot).int(p.bx).int(p.by).int(p.x).int(p.y);
}

/**
 * Everything that determines the game's future: the board, plus the falling piece, the next
 * queue, the RNG, the scores, the sticky key state and both clocks.
 *
 * Deliberately excludes `tmp` and `moved`, which are cascade scratch and only meaningful
 * mid-move, and the sound queue, which test/game.test.ts already pins as unable to affect
 * the simulation.
 */
export function stateHasher(c: Canvas, framecount: number, videoFrame: number): Hasher {
  const h = new Hasher();
  hashBoardInto(h, c);
  h.bigint64(c.rnd.getSeed());
  h.int(c.score).int(c.linesCur).int(c.linesTot).int(c.level);
  h.int(c.depth).int(c.complexity).int(c.speed).int(c.lastX).int(c.frameStart);
  h.bool(c.dead).bool(c.sendForClean);
  hashBloc(h, c.bloc);
  hashBloc(h, c.next);
  hashBloc(h, c.next2);
  hashBloc(h, c.next3);
  const groups = c.keyGroups();
  h.bytes(c.keys, 0, c.keys.length).bytes(groups, 0, groups.length);
  h.int(c.hRepeatDelay).int(c.vRepeatDelay).int(c.sideSpeed).int(c.downSpeed);
  h.bool(c.continuous);
  h.int(framecount).int(videoFrame);
  return h;
}

export function stateHashOf(c: Canvas, framecount: number, videoFrame: number): string {
  return stateHasher(c, framecount, videoFrame).digest();
}

export function stateHash(g: Game): string {
  return stateHashOf(g.canvas, g.frame, g.env.videoFrame);
}

/** The same digest as `stateHash`, unformatted — what a checkpoint stores in a recording. */
export function stateLanes(g: Game): [number, number] {
  return stateHasher(g.canvas, g.frame, g.env.videoFrame).lanes();
}
