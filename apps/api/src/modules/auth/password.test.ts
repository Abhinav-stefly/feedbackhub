import { describe, expect, it } from 'vitest';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('uses Argon2id and never stores the password itself', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse battery');
  });

  it('gives different hashes for the same password (random salt)', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password-1'),
      hashPassword('same-password-1'),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('right-password-123');
    expect(await verifyPassword(hash, 'right-password-123')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password-123')).toBe(false);
  });

  it('treats a corrupted stored hash as a failed login, not a crash', async () => {
    expect(await verifyPassword('not-a-real-hash', 'anything')).toBe(false);
  });

  it('provides a reusable dummy hash for timing protection', async () => {
    const first = await getDummyHash();
    expect(first.startsWith('$argon2id$')).toBe(true);
    expect(await getDummyHash()).toBe(first);
  });
});
