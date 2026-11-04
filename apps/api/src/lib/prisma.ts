import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The ONE database client for the whole app. Prisma 7 talks to PostgreSQL
 * through a "driver adapter" (here: the standard `pg` driver).
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

const CHECK_TIMEOUT_MS = 2000;

/** Resolves if the database answers a trivial query; rejects if it errors or is too slow. */
export async function checkDatabase(): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Database check timed out')), CHECK_TIMEOUT_MS).unref(),
  );
  await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
}