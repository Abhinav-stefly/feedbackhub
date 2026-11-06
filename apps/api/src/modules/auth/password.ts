import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with the library defaults (19 MiB memory, 2 passes): the settings the
 * OWASP password-storage guide recommends. Each hash gets its own random salt
 * automatically, and the result is a self-describing string such as
 * "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>".
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // A malformed stored hash must never crash a login or let anyone in.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * A real hash of a throw-away password. When someone logs in with an email that
 * does not exist, we still verify against this, so "unknown email" takes about
 * as long as "wrong password" and timing cannot reveal which emails are registered.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  return dummyHash;
}
