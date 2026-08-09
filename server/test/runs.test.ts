import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { fromBase64 } from 'quadra-web/replay/codec';
import {
  ByteReader,
  decodeHeader,
  encodeHeader,
  encodeTape,
  decodeTape,
} from 'quadra-web/replay/tape';
import { call, captureMail, registerVerified, reset } from './helpers.js';
import { newId } from '../src/ids.js';
import { seedsMatch } from '../src/runs.js';

/**
 * The recording the front page plays, submitted as if somebody had just played it.
 *
 * A real tape rather than a hand-built one: it was produced by the recorder, it verifies in the
 * browser's own test suite, and it is the only artifact in this repository that both engines
 * have an opinion about.
 */
const tape = () => fromBase64(env.TEST_DEMO_TAPE);
const tapeSeed = () => decodeHeader(new ByteReader(tape())).header.seed.toString();

/**
 * What the browser gets for this tape.
 *
 * Pinned as a literal on purpose. The server is supposed to be running the same simulation the
 * client ran, and the only way that claim can be checked is for both sides to agree on a number
 * neither of them derived from the other. If this figure ever moves, either the engine changed —
 * in which case `web/test/demo.test.ts` moves with it and the demo needs re-recording — or the
 * Worker is linked against something that is not the client's engine, which is the failure this
 * whole design exists to make impossible.
 */
const DEMO_SCORE = 1045;
const DEMO_LINES = 3;
const DEMO_FRAMES = 4548;

beforeAll(captureMail);
beforeEach(reset);

/** A grant for a seed we have a tape for, without playing a game to get one. */
async function grantFor(playerEmail: string, seed: string, over: Partial<{
  playerId: string;
  usedAt: number;
  expiresAt: number;
}> = {}): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM players WHERE email_key = ?')
    .bind(playerEmail.toLowerCase())
    .first<{ id: string }>();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO grants (id, player_id, seed, issued_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      over.playerId ?? row!.id,
      seed,
      Date.now(),
      over.expiresAt ?? Date.now() + 60 * 60 * 1000,
      over.usedAt ?? null,
    )
    .run();
  return id;
}

const submit = (cookie: string, grant: string, bytes: Uint8Array) =>
  call('POST', '/v1/runs', {
    cookie,
    raw: bytes,
    headers: { 'content-type': 'application/octet-stream', 'x-quadra-grant': grant },
  });

describe('the two spellings of a seed', () => {
  /*
   * A seed is an unsigned 64-bit quantity, and JavaScript has no unsigned 64-bit type. The
   * engine canonicalises to signed (`Random.setSeed` runs it through `BigInt.asIntN`) and the
   * tape header reads back signed; the obvious way to mint one produces unsigned. Comparing the
   * two as text rejected every honest run whose seed happened to have the high bit set — which
   * is half of them, so this went unnoticed only because every fixture used seed 1058.
   */
  it('treats the same 64 bits as the same seed either way round', () => {
    expect(seedsMatch(-5395797692038532484n, '13050946381671019132')).toBe(true);
    expect(seedsMatch(13050946381671019132n, '-5395797692038532484')).toBe(true);
    expect(seedsMatch(1058n, '1058')).toBe(true);
    expect(seedsMatch(-1n, '18446744073709551615')).toBe(true);
  });

  it('is still a mismatch when the bits differ', () => {
    expect(seedsMatch(1058n, '1059')).toBe(false);
    expect(seedsMatch(-5395797692038532484n, '13050946381671019133')).toBe(false);
    expect(seedsMatch(1058n, 'not-a-number')).toBe(false);
    expect(seedsMatch(1058n, '')).toBe(false);
  });

  it('issues seeds that survive the round trip through a tape header', async () => {
    // The failure was between minting a seed and reading it back out of a recording, so this
    // does exactly that, through the real codec, for as many seeds as it takes to see a
    // negative one.
    const cookie = await registerVerified('ada@example.com', 'Ada');
    for (let i = 0; i < 16; i++) {
      const issued = await call('POST', '/v1/runs/start', { cookie });
      const seed = issued.body['seed'] as string;
      const header = decodeHeader(
        new ByteReader(
          encodeHeader(
            { ...decodeTape(tape()).header, seed: BigInt(seed) },
            0,
            0,
          ),
        ),
      ).header;
      expect(seedsMatch(header.seed, seed), `seed ${seed}`).toBe(true);
    }
  });
});

describe('asking for a seed', () => {
  it('issues one, bound to the player, and remembers it', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const res = await call('POST', '/v1/runs/start', { cookie });
    expect(res.status).toBe(200);

    const grant = res.body['grant'] as string;
    const seed = res.body['seed'] as string;
    expect(grant).toBeTruthy();
    // Decimal text, because a seed is 64 bits and a JSON number is not. Signed, because that is
    // what the engine canonicalises to and what comes back out of a tape header — so about half
    // of them carry a minus sign, and asserting otherwise is asserting the old bug back.
    expect(seed).toMatch(/^-?\d+$/);
    expect(BigInt(seed)).toBe(BigInt.asIntN(64, BigInt(seed)));

    const row = await env.DB.prepare('SELECT seed, used_at FROM grants WHERE id = ?')
      .bind(grant)
      .first<{ seed: string; used_at: number | null }>();
    expect(row?.seed).toBe(seed);
    expect(row?.used_at).toBeNull();
  });

  it('gives a different seed every time', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const seeds = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const res = await call('POST', '/v1/runs/start', { cookie });
      seeds.add(res.body['seed'] as string);
    }
    expect(seeds.size).toBe(8);
  });

  it('is for signed-in, confirmed players only', async () => {
    expect((await call('POST', '/v1/runs/start')).status).toBe(401);

    await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: 'a-perfectly-fine-password', displayName: 'Ada' },
    });
    const login = await call('POST', '/v1/auth/login', {
      body: { email: 'ada@example.com', password: 'a-perfectly-fine-password' },
    });
    // Signed in but unconfirmed: enough to play, not enough to be ranked. Otherwise the board
    // is farmable with addresses nobody owns.
    const res = await call('POST', '/v1/runs/start', { cookie: login.cookie });
    expect(res.status).toBe(403);
    expect(res.body['error']).toBe('unverified');
  });
});

describe('submitting a run', () => {
  it('derives the score from the tape and puts it on the board', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const grant = await grantFor('ada@example.com', tapeSeed());

    const res = await submit(cookie, grant, tape());
    expect(res.status).toBe(201);

    const run = res.body['run'] as Record<string, unknown>;
    expect(run['score']).toBe(DEMO_SCORE);
    expect(run['lines']).toBe(DEMO_LINES);
    expect(run['frames']).toBe(DEMO_FRAMES);
    expect(run['over']).toBe(true);
    expect(res.body['rank']).toBe(1);

    // And what was stored is the same number, not the one anybody sent.
    const row = await env.DB.prepare('SELECT score, tape_key FROM runs').first<{
      score: number;
      tape_key: string;
    }>();
    expect(row?.score).toBe(DEMO_SCORE);

    // The recording is the artifact. A row that could not be watched would be a claim.
    const stored = await env.TAPES.get(row!.tape_key);
    expect(stored).not.toBeNull();
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(tape());
  });

  it('spends the grant, so the same good run cannot be posted twice', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const grant = await grantFor('ada@example.com', tapeSeed());

    expect((await submit(cookie, grant, tape())).status).toBe(201);
    const again = await submit(cookie, grant, tape());
    expect(again.status).toBe(403);
    expect(again.body['error']).toBe('bad-grant');
  });

  it('refuses a tape played on a seed the grant did not issue', async () => {
    // The whole reason grants exist: without this, a player restarts until the pieces fall
    // kindly and submits only the game that went well.
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const grant = await grantFor('ada@example.com', '999999');

    const res = await submit(cookie, grant, tape());
    expect(res.status).toBe(403);
    expect(res.body['error']).toBe('wrong-seed');
    // Refused before simulating: the header carries the seed, and it is 30-odd bytes in.
    const stored = await env.DB.prepare('SELECT count(*) AS n FROM runs').first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it('refuses a grant belonging to another player', async () => {
    const ada = await registerVerified('ada@example.com', 'Ada');
    await registerVerified('grace@example.com', 'Grace');
    const graces = await grantFor('grace@example.com', tapeSeed());

    const res = await submit(ada, graces, tape());
    expect(res.status).toBe(403);
    expect(res.body['error']).toBe('bad-grant');
  });

  it('refuses an expired grant, and a grant that does not exist', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const stale = await grantFor('ada@example.com', tapeSeed(), { expiresAt: Date.now() - 1 });
    expect((await submit(cookie, stale, tape())).status).toBe(403);
    expect((await submit(cookie, 'never-issued', tape())).status).toBe(403);
  });

  it('refuses a run that was not played under the ranked rules', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const decoded = decodeTape(tape());

    for (const [over, code] of [
      [{ level: 5 }, 'not-level-one'],
      [{ levelUp: false }, 'level-up-off'],
    ] as const) {
      const edited = encodeTape({ ...decoded, header: { ...decoded.header, ...over } });
      const seed = decodeHeader(new ByteReader(edited)).header.seed.toString();
      const grant = await grantFor('ada@example.com', seed);
      const res = await submit(cookie, grant, edited);
      expect(res.body['error'], JSON.stringify(over)).toBe(code);
    }
  });

  it('refuses a tape that is not a tape, and one that has been edited', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');

    const nonsense = await grantFor('ada@example.com', tapeSeed());
    expect((await submit(cookie, nonsense, new Uint8Array([1, 2, 3, 4]))).status).toBe(400);

    // A byte flipped in the body. The recorded checkpoints catch it; nothing is stored.
    const corrupted = tape();
    corrupted[corrupted.length - 8] ^= 0xff;
    const grant = await grantFor('ada@example.com', tapeSeed());
    const res = await submit(cookie, grant, corrupted);
    expect(res.status).toBe(400);
    expect(['unverifiable', 'bad-tape']).toContain(res.body['error']);

    const stored = await env.DB.prepare('SELECT count(*) AS n FROM runs').first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it('refuses an oversized body without reading it', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const grant = await grantFor('ada@example.com', tapeSeed());
    const res = await submit(cookie, grant, new Uint8Array(300 * 1024));
    expect(res.status).toBe(413);
  });

  it('refuses the same end state submitted twice under two grants', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    expect((await submit(cookie, await grantFor('ada@example.com', tapeSeed()), tape())).status).toBe(201);

    const second = await submit(cookie, await grantFor('ada@example.com', tapeSeed()), tape());
    expect(second.status).toBe(409);
    expect(second.body['error']).toBe('duplicate');
  });

  it('is for signed-in, confirmed players only', async () => {
    const anon = await call('POST', '/v1/runs', {
      raw: tape(),
      headers: { 'content-type': 'application/octet-stream', 'x-quadra-grant': 'x' },
    });
    expect(anon.status).toBe(401);
  });
});

describe('reading the board', () => {
  it('ranks best first, and the shorter game when two scores tie', async () => {
    const ada = await registerVerified('ada@example.com', 'Ada');
    await submit(ada, await grantFor('ada@example.com', tapeSeed()), tape());

    // Two more rows, written straight in: this is about the ordering, not about submission.
    await env.DB.prepare(
      `INSERT INTO runs (id, player_id, grant_id, score, lines, level, frames, ticks,
                         paused_ticks, sim_version, seed, state_hash, board_hash, started_at,
                         verified_at, over, tape_key)
       SELECT ?, id, NULL, ?, 9, 1, ?, 1, 0, 1, '1', ?, 'b', 0, ?, 1, 'k'
         FROM players WHERE email_key = 'ada@example.com'`,
    )
      .bind(newId(), 9000, 500, 'h1', Date.now())
      .run();
    await env.DB.prepare(
      `INSERT INTO runs (id, player_id, grant_id, score, lines, level, frames, ticks,
                         paused_ticks, sim_version, seed, state_hash, board_hash, started_at,
                         verified_at, over, tape_key)
       SELECT ?, id, NULL, ?, 9, 1, ?, 1, 0, 1, '1', ?, 'b', 0, ?, 1, 'k'
         FROM players WHERE email_key = 'ada@example.com'`,
    )
      .bind(newId(), 9000, 400, 'h2', Date.now())
      .run();

    const res = await call('GET', '/v1/leaderboard');
    const runs = res.body['runs'] as Record<string, unknown>[];
    expect(runs.map((r) => [r['score'], r['frames']])).toEqual([
      [9000, 400],
      [9000, 500],
      [DEMO_SCORE, DEMO_FRAMES],
    ]);
    expect(runs[0]!['rank']).toBe(1);
    expect(runs[0]!['player']).toBe('Ada');
  });

  it('is public, and cached briefly enough that a new record shows up', async () => {
    const res = await call('GET', '/v1/leaderboard');
    expect(res.status).toBe(200);
    expect(res.response.headers.get('cache-control')).toContain('public');
  });

  it('hands back the tape behind a row, so the row can be watched', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    const posted = await submit(cookie, await grantFor('ada@example.com', tapeSeed()), tape());
    const id = (posted.body['run'] as Record<string, unknown>)['id'] as string;

    const summary = await call('GET', `/v1/runs/${id}`);
    expect((summary.body['run'] as Record<string, unknown>)['score']).toBe(DEMO_SCORE);

    const bytes = await call('GET', `/v1/runs/${id}/tape`);
    expect(bytes.status).toBe(200);
    expect(new Uint8Array(await bytes.response.arrayBuffer())).toEqual(tape());
    // A tape never changes once it is verified.
    expect(bytes.response.headers.get('cache-control')).toContain('immutable');
  });

  it('is a 404 for a run that does not exist', async () => {
    expect((await call('GET', '/v1/runs/nope')).status).toBe(404);
    expect((await call('GET', '/v1/runs/nope/tape')).status).toBe(404);
  });

  it('keeps the runs of a closed account, under a name that is nobody', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    await submit(cookie, await grantFor('ada@example.com', tapeSeed()), tape());
    await call('DELETE', '/v1/auth/me', { cookie, body: { password: 'a-perfectly-fine-password' } });

    const res = await call('GET', '/v1/leaderboard');
    const runs = res.body['runs'] as Record<string, unknown>[];
    // Deleting the run would rewrite the history of everyone ranked against it.
    expect(runs).toHaveLength(1);
    expect(runs[0]!['score']).toBe(DEMO_SCORE);
    expect(runs[0]!['player']).toBe('a departed player');
  });
});
