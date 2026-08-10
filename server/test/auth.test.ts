import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  GOOD_PASSWORD,
  call,
  captureMail,
  linkFor,
  mailbox,
  registerVerified,
  reset,
} from './helpers.js';

beforeAll(captureMail);
beforeEach(reset);

describe('registering', () => {
  it('creates an unverified account and sends a link', async () => {
    const res = await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    expect(res.status).toBe(202);
    // No session yet: registering is not proof of the address.
    expect(res.cookie).toBeNull();

    const row = await env.DB.prepare('SELECT display_name, verified_at FROM players').first<{
      display_name: string;
      verified_at: number | null;
    }>();
    expect(row?.display_name).toBe('Ada');
    expect(row?.verified_at).toBeNull();
    expect(linkFor('ada@example.com', 'verify')).toBeTruthy();
  });

  it('never stores the password', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    const row = await env.DB.prepare('SELECT password_hash FROM players').first<{
      password_hash: string;
    }>();
    expect(row?.password_hash).not.toContain(GOOD_PASSWORD);
    expect(row?.password_hash).toMatch(/^pbkdf2\$sha256\$\d+\$/);
  });

  it('will not say whether an address is already registered', async () => {
    const first = await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    const second = await call('POST', '/v1/auth/register', {
      body: { email: 'ADA@example.com', password: GOOD_PASSWORD, displayName: 'Someone' },
      ip: '203.0.113.2',
    });

    // Identical answer. The only difference is which message lands in a mailbox only its owner
    // can read — which is the whole point.
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);

    const players = await env.DB.prepare('SELECT count(*) AS n FROM players').first<{ n: number }>();
    expect(players?.n).toBe(1);
    expect(mailbox[0]?.text).toContain('already has an account');
  });

  it('does say when a display name is taken, because a name is public', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    const clash = await call('POST', '/v1/auth/register', {
      body: { email: 'grace@example.com', password: GOOD_PASSWORD, displayName: 'ada' },
      ip: '203.0.113.3',
    });
    expect(clash.status).toBe(409);
    expect(clash.body['error']).toBe('name-taken');
  });

  it('folds names hard enough that two rows cannot be read as one person', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'a@example.com', password: GOOD_PASSWORD, displayName: 'great_player' },
    });
    const near = await call('POST', '/v1/auth/register', {
      body: { email: 'b@example.com', password: GOOD_PASSWORD, displayName: 'Great Player' },
      ip: '203.0.113.4',
    });
    expect(near.status).toBe(409);
  });

  it('refuses what it cannot put on a board', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ email: 'not-an-address', displayName: 'Ada' }, 'bad-email'],
      [{ email: 'a@example.com', displayName: 'no' }, 'bad-name'],
      [{ email: 'a@example.com', displayName: '  ' }, 'bad-request'],
      [{ email: 'a@example.com', displayName: 'x'.repeat(21) }, 'bad-name'],
      [{ email: 'a@example.com', displayName: 'admin' }, 'bad-name'],
      [{ email: 'a@example.com', displayName: '....' }, 'bad-name'],
    ];
    for (const [body, code] of cases) {
      const res = await call('POST', '/v1/auth/register', {
        body: { password: GOOD_PASSWORD, ...body },
        ip: '203.0.113.5',
      });
      expect(res.body['error'], JSON.stringify(body)).toBe(code);
    }
  });

  it('refuses a password that is too short, too long or too obvious', async () => {
    const attempt = (password: string) =>
      call('POST', '/v1/auth/register', {
        body: { email: 'ada@example.com', password, displayName: 'Ada' },
        ip: '203.0.113.6',
      });
    expect((await attempt('short')).body['error']).toBe('bad-password-too-short');
    expect((await attempt('x'.repeat(300))).body['error']).toBe('bad-password-too-long');
    expect((await attempt('ada@example.com')).body['error']).toBe('bad-password-too-obvious');
    expect((await attempt('qwertyuiop')).body['error']).toBe('bad-password-too-obvious');
    // Shortness is checked first, so the famous eight-letter one never reaches the name list.
    expect((await attempt('password')).body['error']).toBe('bad-password-too-short');
  });
});

describe('confirming the address', () => {
  it('marks the account verified and signs it in', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    const token = linkFor('ada@example.com', 'verify')!;

    const res = await call('POST', '/v1/auth/verify', { body: { token } });
    expect(res.status).toBe(200);
    expect(res.cookie).toBeTruthy();
    expect((res.body['player'] as Record<string, unknown>)['verified']).toBe(true);

    const me = await call('GET', '/v1/auth/me', { cookie: res.cookie });
    expect((me.body['player'] as Record<string, unknown>)['displayName']).toBe('Ada');
  });

  it('spends the link, so a leaked mail cannot be used twice', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    const token = linkFor('ada@example.com', 'verify')!;

    expect((await call('POST', '/v1/auth/verify', { body: { token } })).status).toBe(200);
    const again = await call('POST', '/v1/auth/verify', { body: { token } });
    expect(again.status).toBe(400);
    expect(again.body['error']).toBe('bad-token');
  });

  it('refuses a link that was never issued', async () => {
    const res = await call('POST', '/v1/auth/verify', { body: { token: 'made-up' } });
    expect(res.status).toBe(400);
  });

  it('invalidates the previous link when a new one is asked for', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    const first = linkFor('ada@example.com', 'verify')!;
    mailbox.length = 0;

    await call('POST', '/v1/auth/resend', { body: { email: 'ada@example.com' } });
    const second = linkFor('ada@example.com', 'verify')!;
    expect(second).not.toBe(first);

    expect((await call('POST', '/v1/auth/verify', { body: { token: first } })).status).toBe(400);
    expect((await call('POST', '/v1/auth/verify', { body: { token: second } })).status).toBe(200);
  });

  it('will not resend to an address with no account, and says so no differently', async () => {
    const known = await call('POST', '/v1/auth/resend', { body: { email: 'nobody@example.com' } });
    expect(known.status).toBe(202);
    expect(mailbox).toHaveLength(0);
  });
});

describe('signing in', () => {
  it('accepts the password and returns the player', async () => {
    await registerVerified('ada@example.com', 'Ada');
    const res = await call('POST', '/v1/auth/login', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.cookie).toBeTruthy();
    expect((res.body['player'] as Record<string, unknown>)['displayName']).toBe('Ada');
  });

  it('answers a wrong password and an unknown address identically', async () => {
    await registerVerified('ada@example.com', 'Ada');
    const wrong = await call('POST', '/v1/auth/login', {
      body: { email: 'ada@example.com', password: 'not-the-password' },
    });
    const unknown = await call('POST', '/v1/auth/login', {
      body: { email: 'nobody@example.com', password: 'not-the-password' },
      ip: '203.0.113.7',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.cookie).toBeNull();
  });

  it('is case-insensitive about the address and not about the password', async () => {
    await registerVerified('ada@example.com', 'Ada');
    expect(
      (
        await call('POST', '/v1/auth/login', {
          body: { email: 'ADA@Example.COM', password: GOOD_PASSWORD },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', '/v1/auth/login', {
          body: { email: 'ada@example.com', password: GOOD_PASSWORD.toUpperCase() },
        })
      ).status,
    ).toBe(401);
  });

  it('signs out on request, and the cookie stops working immediately', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');
    expect((await call('GET', '/v1/auth/me', { cookie })).body['player']).not.toBeNull();

    await call('POST', '/v1/auth/logout', { cookie });
    expect((await call('GET', '/v1/auth/me', { cookie })).body['player']).toBeNull();
  });

  it('is nobody in particular without a cookie', async () => {
    const res = await call('GET', '/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body['player']).toBeNull();
  });
});

describe('forgetting the password', () => {
  it('resets it, signs out everywhere, and signs the new session in', async () => {
    const old = await registerVerified('ada@example.com', 'Ada');
    mailbox.length = 0;

    await call('POST', '/v1/auth/forgot', { body: { email: 'ada@example.com' } });
    const token = linkFor('ada@example.com', 'reset')!;
    expect(token).toBeTruthy();

    const res = await call('POST', '/v1/auth/reset', {
      body: { token, password: 'a-completely-different-one' },
    });
    expect(res.status).toBe(200);
    expect(res.cookie).toBeTruthy();

    // Whoever asked may have been locked out by somebody else holding a session.
    expect((await call('GET', '/v1/auth/me', { cookie: old })).body['player']).toBeNull();

    expect(
      (
        await call('POST', '/v1/auth/login', {
          body: { email: 'ada@example.com', password: 'a-completely-different-one' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', '/v1/auth/login', {
          body: { email: 'ada@example.com', password: GOOD_PASSWORD },
          ip: '203.0.113.8',
        })
      ).status,
    ).toBe(401);
  });

  it('answers the same for an address with no account', async () => {
    const known = await registerVerified('ada@example.com', 'Ada');
    expect(known).toBeTruthy();
    mailbox.length = 0;

    const real = await call('POST', '/v1/auth/forgot', { body: { email: 'ada@example.com' } });
    const fake = await call('POST', '/v1/auth/forgot', {
      body: { email: 'nobody@example.com' },
      ip: '203.0.113.9',
    });
    const nonsense = await call('POST', '/v1/auth/forgot', {
      body: { email: 'not-an-address' },
      ip: '203.0.113.10',
    });

    expect(fake.status).toBe(real.status);
    expect(fake.body).toEqual(real.body);
    // Even a malformed address answers the same way: anything else is a probe that works.
    expect(nonsense.body).toEqual(real.body);
    expect(mailbox.filter((m) => m.to === 'nobody@example.com')).toHaveLength(0);
  });

  it('refuses a weak new password rather than accepting it quietly', async () => {
    await registerVerified('ada@example.com', 'Ada');
    await call('POST', '/v1/auth/forgot', { body: { email: 'ada@example.com' } });
    const token = linkFor('ada@example.com', 'reset')!;

    const res = await call('POST', '/v1/auth/reset', { body: { token, password: 'short' } });
    expect(res.body['error']).toBe('bad-password-too-short');
    // And the link is spent either way — it was in an e-mail, and a retry costs a new one.
    expect(
      (await call('POST', '/v1/auth/reset', { body: { token, password: GOOD_PASSWORD } })).status,
    ).toBe(400);
  });

  it('confirms an unverified address, since reaching the link proves it just as well', async () => {
    await call('POST', '/v1/auth/register', {
      body: { email: 'ada@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
    });
    await call('POST', '/v1/auth/forgot', { body: { email: 'ada@example.com' } });
    const token = linkFor('ada@example.com', 'reset')!;

    const res = await call('POST', '/v1/auth/reset', {
      body: { token, password: 'a-completely-different-one' },
    });
    expect((res.body['player'] as Record<string, unknown>)['verified']).toBe(true);
  });
});

describe('closing an account', () => {
  it('needs the password, and then takes everything personal with it', async () => {
    const cookie = await registerVerified('ada@example.com', 'Ada');

    const wrong = await call('DELETE', '/v1/auth/me', { cookie, body: { password: 'nope' } });
    expect(wrong.status).toBe(401);

    const gone = await call('DELETE', '/v1/auth/me', {
      cookie,
      body: { password: GOOD_PASSWORD },
    });
    expect(gone.status).toBe(200);

    expect((await call('GET', '/v1/auth/me', { cookie })).body['player']).toBeNull();
    const left = await env.DB.prepare('SELECT count(*) AS n FROM players').first<{ n: number }>();
    expect(left?.n).toBe(0);
    // And the name is free again.
    const reused = await call('POST', '/v1/auth/register', {
      body: { email: 'other@example.com', password: GOOD_PASSWORD, displayName: 'Ada' },
      ip: '203.0.113.11',
    });
    expect(reused.status).toBe(202);
  });

  it('refuses when nobody is signed in', async () => {
    const res = await call('DELETE', '/v1/auth/me', { body: { password: GOOD_PASSWORD } });
    expect(res.status).toBe(401);
  });
});

describe('the shape of the API', () => {
  it('answers a health check with what engine it is running', async () => {
    const res = await call('GET', '/v1/health');
    expect(res.status).toBe(200);
    expect(res.body['simVersion']).toBe(1);
  });

  it('is a 404 for a route it does not have, not the page', async () => {
    const res = await call('GET', '/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('not-found');
  });

  it('refuses a body that is not JSON, and one that is too large', async () => {
    const bad = await call('POST', '/v1/auth/login', {
      raw: 'not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.status).toBe(400);

    const huge = await call('POST', '/v1/auth/login', {
      raw: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(20_000) }),
      headers: { 'content-type': 'application/json' },
    });
    expect(huge.status).toBe(413);
  });
});
