/*
 * Reading the board.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Every row here is watchable. That is not a feature bolted on beside the leaderboard — it is the
 * same artifact: what was stored is the recording, and the score is what that recording produces.
 * A board that could show a score it cannot replay would be a board of claims.
 */

import { SIM_VERSION } from 'quadra-web/replay/version';

import type { Env } from './env.js';
import { fail, json } from './http.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** What a run shows as once its player has closed their account. */
const TOMBSTONE = 'a departed player';

export type BoardName = 'all' | 'daily';

interface RunRow {
  id: string;
  display_name: string | null;
  score: number;
  lines: number;
  level: number;
  frames: number;
  ticks: number;
  paused_ticks: number;
  over: number;
  started_at: number;
  verified_at: number;
  seed: string;
  sim_version: number;
}

const shape = (row: RunRow, rank: number) => ({
  rank,
  id: row.id,
  player: row.display_name ?? TOMBSTONE,
  score: row.score,
  lines: row.lines,
  level: row.level,
  frames: row.frames,
  ticks: row.ticks,
  over: row.over === 1,
  startedAt: row.started_at,
  verifiedAt: row.verified_at,
  seed: row.seed,
  simVersion: row.sim_version,
});

export async function leaderboard(env: Env, url: URL, now: number): Promise<Response> {
  const board: BoardName = url.searchParams.get('board') === 'daily' ? 'daily' : 'all';
  const limit = clamp(Number(url.searchParams.get('limit')), DEFAULT_LIMIT);

  // Runs from an engine this build no longer is are history, not competition — an engine change
  // invalidates every stored tape by design, and the score it certified was certified by
  // something else. They stay in the table; they do not stay on the board.
  const since = board === 'daily' ? startOfUtcDay(now) : 0;

  const rows = await env.DB.prepare(
    `SELECT r.id, p.display_name, r.score, r.lines, r.level, r.frames, r.ticks, r.paused_ticks,
            r.over, r.started_at, r.verified_at, r.seed, r.sim_version
       FROM runs r LEFT JOIN players p ON p.id = r.player_id
      WHERE r.sim_version = ? AND r.verified_at >= ?
      ORDER BY r.score DESC, r.frames ASC, r.verified_at ASC
      LIMIT ?`,
  )
    .bind(SIM_VERSION, since, limit)
    .all<RunRow>();

  return json(
    {
      board,
      simVersion: SIM_VERSION,
      runs: rows.results.map((row, i) => shape(row, i + 1)),
    },
    200,
    // Short: a new record should show up on the front page while it still feels new.
    { 'cache-control': 'public, max-age=30' },
  );
}

/** One run's summary. The tape it describes is the next call. */
export async function getRun(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT r.id, p.display_name, r.score, r.lines, r.level, r.frames, r.ticks, r.paused_ticks,
            r.over, r.started_at, r.verified_at, r.seed, r.sim_version
       FROM runs r LEFT JOIN players p ON p.id = r.player_id
      WHERE r.id = ?`,
  )
    .bind(id)
    .first<RunRow>();
  if (!row) return fail('not-found', 404);

  const rank = await env.DB.prepare(
    `SELECT count(*) AS n FROM runs
      WHERE sim_version = ? AND (score > ? OR (score = ? AND frames < ?))`,
  )
    .bind(row.sim_version, row.score, row.score, row.frames)
    .first<{ n: number }>();

  return json({ run: shape(row, (rank?.n ?? 0) + 1) }, 200, {
    'cache-control': 'public, max-age=60',
  });
}

/**
 * The bytes themselves.
 *
 * A tape never changes once it is verified, so this is cached for a year. It is also the one
 * response here that is not JSON: the client hands these straight to `decodeTape`.
 */
export async function getTape(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT tape_key FROM runs WHERE id = ?')
    .bind(id)
    .first<{ tape_key: string }>();
  if (!row) return fail('not-found', 404);

  const object = await env.TAPES.get(row.tape_key);
  // A row whose blob has gone is a broken promise rather than a missing page, so it says so.
  if (!object) return fail('tape-missing', 410);

  return new Response(object.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    },
  });
}

function clamp(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function startOfUtcDay(now: number): number {
  return Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
}
