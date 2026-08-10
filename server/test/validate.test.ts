import { describe, it, expect } from 'vitest';
import { checkPassword, emailKey, nameKey, normalizeEmail, normalizeName } from '../src/validate.js';

describe('display names', () => {
  it('accepts the names people actually pick', () => {
    // The first version of this rule required alphanumerics with single separators between
    // them, which rejected every one of these. A clan tag and an apostrophe are not exotic.
    for (const name of [
      'Pedro',
      'sub[DdP]',
      '[TAG]Ana',
      "O'Brien",
      'né0n',
      '日本語',
      'great_player',
      'x.y.z',
      'Mr. Bean',
      'a-b',
      'w00t!',
    ]) {
      expect(normalizeName(name), name).toBe(name);
    }
  });

  it('refuses text that does not render as what it is', () => {
    // A name sits in a row next to other people's. It may not reorder that row, and it may not
    // be a different string from the one it looks like.
    expect(normalizeName('ad​min')).toBeNull(); // zero-width space
    expect(normalizeName('a‮reverse')).toBeNull(); // right-to-left override
    expect(normalizeName('two lines')).toBeNull(); // line separator
    expect(normalizeName('tab\there')).toBeNull();
    expect(normalizeName('wide  gap')).toBeNull(); // a run of spaces reads as two names
  });

  it('needs something to actually be a name', () => {
    expect(normalizeName('..')).toBeNull();
    expect(normalizeName('...')).toBeNull(); // long enough, but no letter or digit in it
    expect(normalizeName('[]()')).toBeNull();
    expect(normalizeName('ab')).toBeNull();
    expect(normalizeName('x'.repeat(21))).toBeNull();
    expect(normalizeName('  Pedro  ')).toBe('Pedro');
  });

  it('measures length in characters, not in UTF-16 slots', () => {
    // Twenty of these is twenty, not forty. Astral-plane scripts should not cost double.
    expect(normalizeName('𝐀𝐁𝐂')).toBe('𝐀𝐁𝐂');
    expect(normalizeName('𝐀'.repeat(20))).not.toBeNull();
    expect(normalizeName('𝐀'.repeat(21))).toBeNull();
  });

  it('folds decoration away, so one person cannot be two rows', () => {
    expect(nameKey('[TAG]Ana')).toBe('tagana');
    expect(nameKey('TAG_Ana')).toBe('tagana');
    expect(nameKey('t.a.g.a.n.a')).toBe('tagana');
    expect(nameKey('great_player')).toBe(nameKey('GreatPlayer'));
    expect(nameKey('sub[DdP]')).toBe('subddp');
  });

  it('reserves its own words through the folding too', () => {
    expect(normalizeName('admin')).toBeNull();
    expect(normalizeName('a.d.m.i.n')).toBeNull();
    expect(normalizeName('[ADMIN]')).toBeNull();
    expect(normalizeName('Quadra')).toBeNull();
    // But a name that merely contains one is fine — it is not the same person.
    expect(normalizeName('admin1')).toBe('admin1');
    expect(normalizeName('badminton')).toBe('badminton');
  });
});

describe('e-mail addresses', () => {
  it('is loose, because the confirmation link is what actually proves one', () => {
    for (const address of ['a@b.co', 'first.last+tag@example.co.uk', 'x@y.z']) {
      expect(normalizeEmail(address), address).toBe(address);
    }
  });

  it('refuses what is plainly not an address', () => {
    for (const bad of ['nope', 'a@b', '@b.co', 'a b@c.co', 'a@b .co', '', 'a@'.repeat(200)]) {
      expect(normalizeEmail(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('folds case, so one address cannot be registered twice', () => {
    expect(emailKey('Ada@Example.COM')).toBe('ada@example.com');
    expect(emailKey('  ada@example.com ')).toBe('ada@example.com');
  });
});

describe('passwords', () => {
  it('wants length before anything else', () => {
    expect(checkPassword('short', 'a@b.co', 'Ada')).toBe('too-short');
    expect(checkPassword('x'.repeat(300), 'a@b.co', 'Ada')).toBe('too-long');
    expect(checkPassword('a-perfectly-fine-password', 'a@b.co', 'Ada')).toBeNull();
  });

  it('refuses the two everyone tries first', () => {
    expect(checkPassword('someone@example.com', 'someone@example.com', 'Ada')).toBe('too-obvious');
    expect(checkPassword('averylongname', 'a@b.co', 'averylongname')).toBe('too-obvious');
    expect(checkPassword('qwertyuiop', 'a@b.co', 'Ada')).toBe('too-obvious');
  });
});
