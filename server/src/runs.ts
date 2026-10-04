/*
 * Seed grants, and the runs played on them.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The score a client sends is not read, because there is no field to send it in: what arrives is
 * the recording, and `verify` — the same function, from the same module, that the browser just
 * ran — plays it back and produces the score. That is the whole basis on which a number here is
 * worth anything.
 *
 * Verification alone proves that *these inputs, on this seed, produce this score*. It says
 * nothing about whether the seed was shopped for. So a ranked run starts by asking for one: the
 * server picks it, remembers it, and binds it to one player and one game. That closes three
 * things at once — restarting until the pieces are friendly, submitting the same good run twice,
 * and submitting somebody else's.
 */

import { ByteReader, TapeError, decodeHeader } from 'quadra-web/replay/tape';
import { SIM_VERSION } from 'quadra-web/replay/version';

import type { Env } from './env.js';
import { fail, json } from './http.js';
import { newId } from './ids.js';
import { LIMITS, allow } from './rate-limit.js';
import { currentPlayer } from './session.js';

/** Long enough for a very long game, short enough that grants are not stockpiled. */
const GRANT_TTL_MS = 4 * 60 * 60 * 1000;
/** Roughly two hours of dense play. Anything larger is not a run, it is a payload. */
export const MAX_TAPE_BYTES = 256 * 1024;
/** A minute of pause is nobody's business. */
const PAUSE_GRACE_TICKS = 6_000;

/**
 * The rules a run has to have been played under to be ranked.
 *
 * Only what changes the difficulty. Sensitivity is feel, not advantage, and the ghost piece is an
 * assist that a player can only *decline* — so neither splits the board.
 */
function unranked(header: { level: number; levelUp: boolean }): string | null {
  if (header.level !== 1) return 'not-level-one';
  if (!header.levelUp) return 'level-up-off';
  return null;
}

/** A seed for a game that has not been played yet. */
export async function startRun(env: Env, request: Request, now: number): Promise<Response> {
  const player = await currentPlayer(env, request, now);
  if (!player) return fail('unauthenticated', 401);
  if (player.verifiedAt === null) return fail('unverified', 403);
  if (!(await allow(env, LIMITS.grantPerPlayer, player.id, now))) return fail('rate-limited', 429);

  // Signed, because that is what the engine canonicalises a seed to (`Random.setSeed` runs it
  // through `BigInt.asIntN(64, …)`) and what the tape header reads back. Issuing it in the same
  // spelling keeps `grants.seed` and `runs.seed` comparable by eye as well as by `seedsMatch`.
  const seed = BigInt.asIntN(64, crypto.getRandomValues(new BigUint64Array(1))[0]!);
  const id = newId();
  const expiresAt = now + GRANT_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO grants (id, player_id, seed, issued_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, player.id, seed.toString(), now, expiresAt)
    .run();

  // Decimal text, not a number: a seed is 64 bits and JSON numbers are not.
  return json({ grant: id, seed: seed.toString(), expiresAt });
}

/**
 * Submit a finished run.
 *
 * The tape is the body — raw bytes, not base64 in a JSON field. A tape is up to 256 KB and base64
 * would make that a third larger for no reason, on the one request in this service where size is
 * worth caring about. The grant travels in a header rather than the query string so it stays out
 * of access logs.
 */
export async function submitRun(env: Env, request: Request, now: number): Promise<Response> {
  const player = await currentPlayer(env, request, now);
  if (!player) return fail('unauthenticated', 401);
  if (player.verifiedAt === null) return fail('unverified', 403);
  if (!(await allow(env, LIMITS.submitPerPlayer, player.id, now))) return fail('rate-limited', 429);

  const grantId = request.headers.get('x-quadra-grant');
  if (!grantId || grantId.length > 64) return fail('bad-grant', 400);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_TAPE_BYTES) return fail('too-large', 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return fail('bad-tape', 400);
  if (bytes.length > MAX_TAPE_BYTES) return fail('too-large', 413);

  const grant = await env.DB.prepare(
    'SELECT id, player_id, seed, expires_at, used_at FROM grants WHERE id = ?',
  )
    .bind(grantId)
    .first<{
      id: string;
      player_id: string;
      seed: string;
      expires_at: number;
      used_at: number | null;
    }>();

  // One answer for every way a grant can be wrong. Which one it was is not information the
  // submitter is entitled to, and telling them turns grant ids into something worth guessing.
  if (!grant || grant.player_id !== player.id || grant.used_at !== null || grant.expires_at <= now) {
    return fail('bad-grant', 403);
  }

  // Before simulating anything: the header is a couple of dozen bytes and it carries the two
  // things that can disqualify a run outright.
  let header;
  try {
    header = decodeHeader(new ByteReader(bytes)).header;
  } catch (err) {
    return fail('bad-tape', 400, err instanceof TapeError ? err.code : undefined);
  }

  if (!seedsMatch(header.seed, grant.seed)) return fail('wrong-seed', 403);
  const wrongRules = unranked(header);
  if (wrongRules) return fail(wrongRules, 400);

  // Replayed in a Durable Object rather than here: this handler has 10 ms of CPU on the free
  // plan and a long run needs several times that. One object per player, so two people
  // submitting at once are not queued behind each other. See `verifier.ts`.
  const verifier = env.VERIFIER.get(env.VERIFIER.idFromName(player.id));
  const result = await verifier.check(bytes, MAX_TAPE_BYTES);
  if (!result.ok) return fail('unverifiable', 400, `${result.code} at frame ${result.frame}`);
  if (result.header.simVersion !== SIM_VERSION) return fail('unverifiable', 400, 'sim-version');

  // A game nobody scored in is a game, not a record.
  if (result.score <= 0) return fail('no-score', 400);

  // Pausing gates input but not the clock, so it is time to think that costs nothing. A minute
  // is nobody's business; past that, a quarter of the time actually played.
  const played = result.ticks - result.pausedTicks;
  if (result.pausedTicks > PAUSE_GRACE_TICKS + Math.floor(played / 4)) {
    return fail('too-much-pause', 400);
  }

  const already = await env.DB.prepare(
    'SELECT id FROM runs WHERE player_id = ? AND state_hash = ? AND frames = ?',
  )
    .bind(player.id, result.stateHash, result.frames)
    .first<{ id: string }>();
  if (already) return fail('duplicate', 409);

  const id = newId();
  const tapeKey = `tapes/${result.header.simVersion}/${id}`;

  // R2 first: a blob nothing points at is litter, but a row pointing at a blob that is not there
  // is a leaderboard entry that cannot be watched.
  await env.TAPES.put(tapeKey, bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO runs (id, player_id, grant_id, score, lines, level, frames, ticks,
                         paused_ticks, sim_version, seed, state_hash, board_hash, started_at,
                         verified_at, over, tape_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      player.id,
      grant.id,
      result.score,
      result.lines,
      result.level,
      result.frames,
      result.ticks,
      result.pausedTicks,
      result.header.simVersion,
      result.header.seed.toString(),
      result.stateHash,
      result.boardHash,
      result.header.startedAt,
      now,
      result.over ? 1 : 0,
      tapeKey,
    ),
    env.DB.prepare('UPDATE grants SET used_at = ? WHERE id = ?').bind(now, grant.id),
  ]);

  return json(
    {
      run: {
        id,
        score: result.score,
        lines: result.lines,
        level: result.level,
        frames: result.frames,
        ticks: result.ticks,
        over: result.over,
      },
      rank: await rankOf(env, result.header.simVersion, result.score, result.frames),
    },
    201,
  );
}

/**
 * Whether a tape was played on the seed that was granted.
 *
 * Compared as 64 bits rather than as text. A seed is an unsigned 64-bit quantity that JavaScript
 * has no unsigned 64-bit type for, so it gets spelled either way depending on who last touched
 * it — and `"-5395797692038532484"` and `"13050946381671019132"` are the same seed. Comparing
 * the strings rejected every honest run.
 */
export function seedsMatch(fromTape: bigint, granted: string): boolean {
  try {
    return BigInt.asIntN(64, fromTape) === BigInt.asIntN(64, BigInt(granted));
  } catch {
    return false;
  }
}

/** Where a score sits on the board: one more than the number of runs that beat it. */
async function rankOf(
  env: Env,
  simVersion: number,
  score: number,
  frames: number,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM runs
      WHERE sim_version = ? AND (score > ? OR (score = ? AND frames < ?))`,
  )
    .bind(simVersion, score, score, frames)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}
