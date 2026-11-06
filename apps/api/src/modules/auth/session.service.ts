import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { publicUserSelect, type PublicUser } from './auth.service.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** The database stores only this fingerprint, never the token itself. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(prisma: PrismaClient, userId: string) {
  // 32 random bytes from the operating system's secure generator: unguessable.
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

/** Returns the logged-in user for a session token, or null if invalid/expired. */
export async function findUserBySessionToken(
  prisma: PrismaClient,
  token: string,
): Promise<PublicUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, user: { select: publicUserSelect } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session.user;
}

export async function deleteSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
