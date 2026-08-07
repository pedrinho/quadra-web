/*
 * The local leaderboard: finished runs, kept in localStorage.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * This is the server, standing in for itself until there is one. It does the two things the
 * real backend will do and in the same order, so that swapping localStorage for an endpoint
 * later changes where runs are kept and nothing about what a run means:
 *
 *   1. The submitted score is ignored. The tape is verified and the score comes out of that.
 *   2. What is stored is the recording, not a number. Anything the board displays can be
 *      re-derived from it, and anything it claims can be watched.
 *
 * Stored data is treated as hostile, the way `normalizeSettings` treats stored settings: the
 * player can edit this blob, and on a real backend the equivalent bytes arrive over the wire.
 */

import { verify, type VerifyErrorCode } from './replay/verify.js';
import { SIM_VERSION } from './replay/version.js';

/** One finished run. The tape is the artifact; every other field is derived from it. */
export interface StoredRun {
  id: string;
  /** Base64 of the tape bytes. */
  tape: string;
  score: number;
  lines: number;
  level: number;
  frames: number;
  ticks: number;
  /** Decimal, because a seed is a 64-bit bigint. */
  seed: string;
  simVersion: number;
  /** When the run was played, and when it was saved. Milliseconds since the epoch. */
  startedAt: number;
  savedAt: number;
  /** Whether the run ended in a top-out rather than the tape simply stopping. */
  over: boolean;
  /** The verified end state, used to spot the same run submitted twice. */
  stateHash: string;
}

/** Five, which is what the original kept and what its highscore screen has room for
 *  (MAX_SCORE, source/highscores.h:28). */
export const MAX_RUNS = 5;
/** Roughly two hours of dense play. Anything larger is not a run, it is a payload. */
export const MAX_TAPE_BYTES = 256 * 1024;

const STORAGE_KEY = 'quadra.runs.v1';

export type SaveFailure =
  | { ok: false; reason: 'too-big' }
  | { ok: false; reason: 'unverifiable'; code: VerifyErrorCode; message: string }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'not-a-record' };

export type SaveResult = { ok: true; run: StoredRun; rank: number; runs: StoredRun[] } | SaveFailure;

/**
 * Verify a tape and, if it earns a place, keep it.
 *
 * `not-a-record` is not an error: the run was fine, it just did not beat anything on a full
 * board. Saying so is better than pretending it was stored.
 */
export function saveRun(
  bytes: Uint8Array,
  store: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): SaveResult {
  if (bytes.length > MAX_TAPE_BYTES) return { ok: false, reason: 'too-big' };

  const result = verify(bytes);
  if (!result.ok) {
    return { ok: false, reason: 'unverifiable', code: result.code, message: result.message };
  }

  // A game nobody scored in is a game, not a record. Keeping those would fill the board with
  // noise and push out runs worth watching.
  if (result.score <= 0) return { ok: false, reason: 'not-a-record' };

  const runs = loadRuns(store);
  if (runs.some((r) => r.stateHash === result.stateHash && r.frames === result.frames)) {
    return { ok: false, reason: 'duplicate' };
  }

  const run: StoredRun = {
    id: newId(),
    tape: toBase64(bytes),
    score: result.score,
    lines: result.lines,
    level: result.level,
    frames: result.frames,
    ticks: result.ticks,
    seed: result.header.seed.toString(),
    simVersion: result.header.simVersion,
    startedAt: result.header.startedAt,
    savedAt: Date.now(),
    over: result.over,
    stateHash: result.stateHash,
  };

  const kept = rank([...runs, run]);
  if (!kept.includes(run)) return { ok: false, reason: 'not-a-record' };

  write(store, kept);
  return { ok: true, run, rank: kept.indexOf(run) + 1, runs: kept };
}

/** Best first. Anything unreadable is dropped rather than allowed to break the board. */
export function loadRuns(
  store: Pick<Storage, 'getItem'> | null = safeStorage(),
): StoredRun[] {
  if (!store) return [];
  try {
    const text = store.getItem(STORAGE_KEY);
    if (text === null) return [];
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return rank(raw.map(normalizeRun).filter((r): r is StoredRun => r !== null));
  } catch {
    return [];
  }
}

export function clearRuns(store: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  write(store, []);
}

/** The bytes behind a stored run, or null if the entry has been mangled. */
export function tapeOf(run: StoredRun): Uint8Array | null {
  try {
    return fromBase64(run.tape);
  } catch {
    return null;
  }
}

/** Runs recorded by a simulation this build no longer is. Kept, but not comparable. */
export const isStale = (run: StoredRun): boolean => run.simVersion !== SIM_VERSION;

/* --- internals ----------------------------------------------------------- */

/**
 * Best score first, ties broken by the shorter run — the same score in fewer frames is the
 * better game — then by whichever arrived first, so the board does not shuffle on reload.
 */
function rank(runs: StoredRun[]): StoredRun[] {
  return [...runs]
    .sort((a, b) => b.score - a.score || a.frames - b.frames || a.savedAt - b.savedAt)
    .slice(0, MAX_RUNS);
}

function write(store: Pick<Storage, 'setItem'> | null, runs: StoredRun[]): void {
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // A full quota or a private window. Dropping the weakest run and retrying once is worth
    // it; failing outright is not, since the game itself is unaffected.
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, Math.max(0, runs.length - 1))));
    } catch {
      /* give up quietly: a leaderboard is not worth an exception in the game loop */
    }
  }
}

const int = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
};

function normalizeRun(raw: unknown): StoredRun | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const score = int(o['score'], 0, Number.MAX_SAFE_INTEGER);
  const frames = int(o['frames'], 0, Number.MAX_SAFE_INTEGER);
  if (score === null || frames === null) return null;
  if (typeof o['tape'] !== 'string' || typeof o['id'] !== 'string') return null;
  return {
    id: o['id'],
    tape: o['tape'],
    score,
    frames,
    lines: int(o['lines'], 0, Number.MAX_SAFE_INTEGER) ?? 0,
    level: int(o['level'], 1, 1000) ?? 1,
    ticks: int(o['ticks'], 0, Number.MAX_SAFE_INTEGER) ?? 0,
    seed: typeof o['seed'] === 'string' ? o['seed'] : '0',
    simVersion: int(o['simVersion'], 0, 65535) ?? 0,
    startedAt: int(o['startedAt'], 0, Number.MAX_SAFE_INTEGER) ?? 0,
    savedAt: int(o['savedAt'], 0, Number.MAX_SAFE_INTEGER) ?? 0,
    over: o['over'] === true,
    stateHash: typeof o['stateHash'] === 'string' ? o['stateHash'] : '',
  };
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
}

/* --- base64 -------------------------------------------------------------- */

/**
 * Tapes are bytes and localStorage holds strings. `btoa`/`atob` exist in both the browser and
 * the server runtimes this will eventually run on, so no Buffer and no dependency — the cost
 * is having to hand them latin1 a chunk at a time.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // apply() blows the argument limit somewhere above this
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
