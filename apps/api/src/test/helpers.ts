import { createApp, type AppConfig } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

export const WEB_ORIGIN = 'http://localhost:5173';

/** A real app wired to the real test database. Override config per test. */
export function buildApp(config: Partial<AppConfig> = {}) {
  return createApp({
    checkDatabase: async () => {},
    prisma,
    config: {
      webOrigin: WEB_ORIGIN,
      secureCookies: false,
      authRateLimit: { windowMs: 60_000, limit: 1000 }, // generous: tests make many requests
      ...config,
    },
  });
}

/** Empties every table. Refuses to run on anything but a *_test database. */
export async function resetDatabase() {
  const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to wipe database "${dbName}"`);
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Session","RoadmapUpdate","Comment","Vote","Feedback","Project","WorkspaceMember","Workspace","User" CASCADE`,
  );
}
