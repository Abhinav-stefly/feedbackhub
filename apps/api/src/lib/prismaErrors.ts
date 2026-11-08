import { Prisma } from '../generated/prisma/client.js';

/** True when the database refused a write because a UNIQUE rule would be broken (Prisma code P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
