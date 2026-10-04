import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { GOOD_PASSWORD, call, captureMail, cookieFrom, linkFor, reset } from './helpers.js';
import { base64url } from '../src/ids.js';

/*
 * Google is not reachable from here, and should not be: what is under test is what this Worker
 * does with what Google says. So the token endpoint is stood in for — the tests import the Worker
 * into their own isolate, and its `fetch` is the one spied on below — and everything either side
 * of that one request is real.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface Claims {
  sub: string;
  email: string;
  email_verified?: boolean;
  aud?: string;
  iss?: string;
  exp?: number;
}

/** What a token endpoint answers: an id_token whose signature nobody here checks. */
function idToken(claims: Claims): string {
  const payload = {
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email_verified: true,
    ...claims,
  };
  const part = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(payload)}.unchecked`;
}

/** Every form Google's token endpoint was sent, most recent last. */
const exchanges: URLSearchParams[] = [];

/** Stand in for the token endpoint. Anything else the Worker fetches is a test failure. */
function googleAnswers(answer: Claims | Response): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKEN_ENDPOINT) throw new Error(`unexpected fetch to ${url}`);
    exchanges.push(new URLSearchParams(String(init?.body ?? '')));
    if (answer instanceof Response) return answer;
    return Response.json({ id_token: idToken(answer), access_token: 'x', token_type: 'Bearer' });
  });
}

/** The first leg: ask to sign in, and come back with where Google was told to send us. */
async function start(returnTo = '/records') {
  const res = await call('GET', `/v1/auth/google/start?return=${encodeURIComponent(returnTo)}`);
  const location = new URL(res.response.headers.get('location') ?? 'about:blank');
  const flow = cookieFrom(res.response, 'quadra_oauth') ?? '';
  return { res, location, flow, state: location.searchParams.get('state') ?? '' };
}

/** The whole round trip, with Google saying `claims`. Returns the callback's answer. */
async function signIn(claims: Claims | Response, returnTo = '/records') {
  const { flow, state } = await start(returnTo);
  googleAnswers(claims);
  return call('GET', `/v1/auth/google/callback?code=a-code&state=${state}`, {
    headers: { cookie: `quadra_oauth=${flow}` },
  });
}

const location = (res: { response: Response }) => res.response.headers.get('location') ?? '';
const welcomeToken = (res: { response: Response }) =>
  new URL(location(res), 'https://x').searchParams.get('welcome') ?? '';

async function finish(token: string, displayName: string) {
  return call('POST', '/v1/auth/google/finish', { body: { token, displayName } });
}

/** A brand-new Google player, all the way through to a session. */
async function newPlayer(sub: string, email: string, name: string): Promise<string> {
  const back = await signIn({ sub, email });
  const done = await finish(welcomeToken(back), name);
  if (!done.cookie) throw new Error(`finish failed: ${done.status}`);
  return done.cookie;
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

beforeAll(captureMail);
beforeEach(async () => {
  exchanges.length = 0;
  await reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('starting a sign-in', () => {
  it('sends the browser to Google with a PKCE challenge, and remembers the way back', async () => {
    const { res, location: to, flow, state } = await start('/records');
    expect(res.status).toBe(302);
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(to.searchParams.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
    expect(to.searchParams.get('redirect_uri')).toBe(
      `${env.PUBLIC_ORIGIN}/v1/auth/google/callback`,
    );
    expect(to.searchParams.get('scope')).toBe('openid email profile');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');

    // The cookie holds the state Google will echo, and the verifier the challenge was made from.
    const [kept, verifier, back] = flow.split('.');
    expect(kept).toBe(state);
    const challenge = base64url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    );
    expect(to.searchParams.get('code_challenge')).toBe(challenge);
    expect(back).toBe('/records');

    // Only the two flow routes ever see it.
    const header = res.response.headers.getAll('set-cookie')[0]!;
    expect(header).toContain('Path=/v1/auth/google');
    expect(header).toContain('HttpOnly');
  });

  it('will only send the browser back to a page of its own', async () => {
    for (const elsewhere of ['https://evil.example/', '//evil.example', '/v1/auth/me', '']) {
      const { flow } = await start(elsewhere);
      expect(flow.split('.')[2]).toBe('/');
    }
  });

  it('is not there when the deployment has no Google client', async () => {
    const res = await call('GET', '/v1/auth/google/start', { env: { GOOGLE_CLIENT_SECRET: '' } });
    expect(res.status).toBe(404);
    const me = await call('GET', '/v1/auth/me', { env: { GOOGLE_CLIENT_SECRET: '' } });
    expect(me.body['methods']).toEqual({ google: false, password: true });
  });
});

describe('coming back from Google', () => {
  it('asks a first-time player for a name before making them a player', async () => {
    const back = await signIn({ sub: 'g-ada', email: 'ada@example.com' });
    expect(back.status).toBe(302);
    expect(location(back)).toMatch(/^\/records\?welcome=[A-Za-z0-9_-]+$/);
    expect(back.cookie).toBeNull();
    expect(await count('players')).toBe(0);
    // The flow cookie is spent whichever way it went.
    const cookies = back.response.headers.getAll('set-cookie').join('\n');
    expect(cookies).toMatch(/quadra_oauth=;.*Max-Age=0/);

    // What went to Google: the code, the secret, and the verifier behind the challenge.
    const sent = exchanges.at(-1)!;
    expect(sent.get('code')).toBe('a-code');
    expect(sent.get('client_secret')).toBe(env.GOOGLE_CLIENT_SECRET);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const done = await finish(welcomeToken(back), 'Ada');
    expect(done.status).toBe(200);
    expect(done.cookie).not.toBeNull();
    expect(done.body['player']).toMatchObject({
      displayName: 'Ada',
      email: 'ada@example.com',
      verified: true,
      password: false,
    });

    const me = await call('GET', '/v1/auth/me', { cookie: done.cookie });
    expect(me.body['player']).toMatchObject({ displayName: 'Ada' });
  });

  it('lets a returning player straight back in', async () => {
    await newPlayer('g-ada', 'ada@example.com', 'Ada');
    const again = await signIn({ sub: 'g-ada', email: 'ada@example.com' }, '/');
    expect(location(again)).toBe('/');
    expect(again.cookie).not.toBeNull();
    const me = await call('GET', '/v1/auth/me', { cookie: again.cookie });
    expect(me.body['player']).toMatchObject({ displayName: 'Ada' });
    expect(await count('players')).toBe(1);
  });

  it('knows a player by their Google account, not by the address on it', async () => {
    await newPlayer('g-ada', 'ada@example.com', 'Ada');
    const moved = await signIn({ sub: 'g-ada', email: 'ada@elsewhere.example' });
    const me = await call('GET', '/v1/auth/me', { cookie: moved.cookie });
    expect(me.body['player']).toMatchObject({ displayName: 'Ada' });
  });

  it('joins the password account that already holds the address', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'grace@example.com', password: GOOD_PASSWORD, displayName: 'Grace' },
    });
    const token = linkFor('grace@example.com', 'verify');
    await call('POST', '/v1/auth/verify', { body: { token } });

    const back = await signIn({ sub: 'g-grace', email: 'Grace@Example.com' });
    expect(location(back)).toBe('/records');
    const me = await call('GET', '/v1/auth/me', { cookie: back.cookie });
    expect(me.body['player']).toMatchObject({ displayName: 'Grace', password: true });

    // She proved the address long ago, so her password still works too.
    const login = await call('POST', '/v1/auth/login', {
      body: { email: 'grace@example.com', password: GOOD_PASSWORD },
    });
    expect(login.status).toBe(200);
  });

  it('takes the password off an unconfirmed account it joins', async () => {
    // Somebody registers an address that is not theirs and never confirms it…
    await call('POST', '/v1/auth/register', {
      body: { email: 'owner@example.com', password: GOOD_PASSWORD, displayName: 'Squatter' },
    });
    // …and the address's owner signs in with Google.
    const back = await signIn({ sub: 'g-owner', email: 'owner@example.com' });
    const me = await call('GET', '/v1/auth/me', { cookie: back.cookie });
    expect(me.body['player']).toMatchObject({ verified: true, password: false });

    // The registrant's password is no longer a way in.
    const login = await call('POST', '/v1/auth/login', {
      body: { email: 'owner@example.com', password: GOOD_PASSWORD },
    });
    expect(login.status).toBe(401);
  });

  it('refuses a callback whose state does not match the one it was sent with', async () => {
    const { flow } = await start();
    googleAnswers({ sub: 'g-ada', email: 'ada@example.com' });
    const forged = await call('GET', '/v1/auth/google/callback?code=a-code&state=not-it', {
      headers: { cookie: `quadra_oauth=${flow}` },
    });
    expect(location(forged)).toBe('/records?signin=failed');
    expect(forged.cookie).toBeNull();
    // Refused before Google was asked anything.
    expect(exchanges).toHaveLength(0);

    const { state } = await start();
    const cookieless = await call('GET', `/v1/auth/google/callback?code=a-code&state=${state}`);
    expect(location(cookieless)).toBe('/?signin=failed');
  });

  it('refuses whatever Google has not vouched for', async () => {
    const id = { sub: 'g-ada', email: 'ada@example.com' };
    const refused: (Claims | Response)[] = [
      { ...id, email_verified: false },
      { ...id, aud: 'somebody-elses-client' },
      { ...id, iss: 'https://accounts.evil.example' },
      { ...id, exp: Math.floor(Date.now() / 1000) - 60 },
      { ...id, email: 'not an address' },
      new Response('{"error":"invalid_grant"}', { status: 400 }),
      new Response('not json', { status: 200 }),
    ];
    for (const answer of refused) {
      const back = await signIn(answer);
      expect(location(back)).toBe('/records?signin=failed');
      expect(back.cookie).toBeNull();
      vi.restoreAllMocks();
    }
    expect(await count('signups')).toBe(0);
  });

  it('sends the player back where they were when they press cancel at Google', async () => {
    const { flow, state } = await start('/');
    const back = await call('GET', `/v1/auth/google/callback?error=access_denied&state=${state}`, {
      headers: { cookie: `quadra_oauth=${flow}` },
    });
    expect(location(back)).toBe('/?signin=failed');
  });
});

describe('choosing a name', () => {
  it('refuses a name that is taken, and lets the player try another', async () => {
    await newPlayer('g-grace', 'grace@example.com', 'Grace');
    const back = await signIn({ sub: 'g-ada', email: 'ada@example.com' });
    const token = welcomeToken(back);

    expect((await finish(token, 'grace')).body['error']).toBe('name-taken');
    expect((await finish(token, '!!')).body['error']).toBe('bad-name');
    expect((await finish(token, 'Ada')).status).toBe(200);
  });

  it('spends the token, so it cannot make a second player', async () => {
    const back = await signIn({ sub: 'g-ada', email: 'ada@example.com' });
    const token = welcomeToken(back);
    expect((await finish(token, 'Ada')).status).toBe(200);
    expect((await finish(token, 'Ada Again')).body['error']).toBe('bad-token');
    expect(await count('players')).toBe(1);
  });

  it('refuses a token that has gone stale', async () => {
    const back = await signIn({ sub: 'g-ada', email: 'ada@example.com' });
    await env.DB.prepare('UPDATE signups SET expires_at = ?').bind(Date.now() - 1).run();
    expect((await finish(welcomeToken(back), 'Ada')).body['error']).toBe('bad-token');
  });

  it('signs in the second tab rather than making a second player', async () => {
    const first = await signIn({ sub: 'g-ada', email: 'ada@example.com' });
    const second = await signIn({ sub: 'g-ada', email: 'ada@example.com' });
    expect((await finish(welcomeToken(first), 'Ada')).status).toBe(200);
    const late = await finish(welcomeToken(second), 'Ada Two');
    expect(late.status).toBe(200);
    expect(late.body['player']).toMatchObject({ displayName: 'Ada' });
    expect(await count('players')).toBe(1);
  });
});

describe('closing a Google account', () => {
  it('asks for the board name rather than a password', async () => {
    const cookie = await newPlayer('g-ada', 'ada@example.com', 'Ada');

    const wrong = await call('DELETE', '/v1/auth/me', { cookie, body: { confirm: 'Grace' } });
    expect(wrong.status).toBe(401);
    expect(wrong.body['error']).toBe('bad-confirm');

    // Folded as names are everywhere else, so the case it was typed in does not matter.
    const right = await call('DELETE', '/v1/auth/me', { cookie, body: { confirm: 'ada' } });
    expect(right.status).toBe(200);
    expect(await count('players')).toBe(0);
    expect(await count('identities')).toBe(0);

    // The same Google account coming back is somebody new, who chooses a name again.
    const back = await signIn({ sub: 'g-ada', email: 'ada@example.com' });
    expect(location(back)).toMatch(/\?welcome=/);
  });
});
