import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/httpError.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';

/**
 * The ONLY user fields that may ever leave the server. Selecting fields explicitly
 * (instead of "everything") means a new sensitive column added later can never
 * leak by accident.
 */
export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
} as const;

export type PublicUser = { id: string; email: string; name: string; createdAt: Date };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function registerUser(
  prisma: PrismaClient,
  input: RegisterInput,
): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.user.create({
      data: { email: input.email, name: input.name, passwordHash },
      select: publicUserSelect,
    });
  } catch (err) {
    // The database's unique rule is the real guard. If two sign-ups race, exactly one wins.
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function authenticateUser(
  prisma: PrismaClient,
  input: LoginInput,
): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true },
  });

  // Always do the expensive hash check, even for unknown emails (see getDummyHash).
  const passwordOk = await verifyPassword(
    user?.passwordHash ?? (await getDummyHash()),
    input.password,
  );

  // One identical message for "no such email" and "wrong password".
  if (!user || !passwordOk) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}
