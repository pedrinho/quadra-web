import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash, ITERATIONS } from '../src/password.js';
import { timingSafeEqual, newToken, newId, digest } from '../src/ids.js';

describe('password hashing', () => {
  it('accepts the password and refuses everything else', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
    // Case matters, and so does the last byte.
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
  });

  it('salts, so the same password twice is two different hashes', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a).not.toBe(b);
    expect(await verifyPassword('hunter2', a)).toBe(true);
    expect(await verifyPassword('hunter2', b)).toBe(true);
  });

  it('records its parameters, so they can be raised later', async () => {
    const stored = await hashPassword('hunter2');
    expect(stored.startsWith(`pbkdf2$sha256$${ITERATIONS}$`)).toBe(true);
    expect(stored.split('$')).toHaveLength(5);
    expect(needsRehash(stored)).toBe(false);
    // A hash from a weaker era still verifies, and asks to be upgraded.
    const weak = `pbkdf2$sha256$1000$${stored.split('$')[3]}$${stored.split('$')[4]}`;
    expect(needsRehash(weak)).toBe(true);
  });

  it('treats a mangled hash as a failed login rather than a crash', async () => {
    // A row can be edited by hand, and a throw here would be a way to learn that an account
    // exists at all.
    for (const bad of ['', 'nonsense', 'pbkdf2$sha256$x$y$z', 'bcrypt$2a$10$abc$def', '$$$$']) {
      expect(await verifyPassword('hunter2', bad)).toBe(false);
    }
  });

  it('handles a password that is not ASCII', async () => {
    const stored = await hashPassword('sénéchal-🜁-пароль');
    expect(await verifyPassword('sénéchal-🜁-пароль', stored)).toBe(true);
    expect(await verifyPassword('senechal-🜁-пароль', stored)).toBe(false);
  });
});

describe('identifiers', () => {
  it('does not repeat itself', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newToken()));
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(tokens.size).toBe(500);
    expect(ids.size).toBe(500);
  });

  it('produces tokens that survive a URL and a cookie unescaped', () => {
    for (let i = 0; i < 50; i++) {
      const token = newToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('stores a digest, never the token', async () => {
    const token = newToken();
    const d = await digest(token);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).not.toContain(token);
    expect(await digest(token)).toBe(d);
    expect(await digest(newToken())).not.toBe(d);
  });

  it('compares without short-circuiting on the first difference', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
