import { createApp, type AppConfig } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import request from 'supertest';

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

export type TestApp = ReturnType<typeof buildApp>;
export type Actor = { cookie: string; user: { id: string; email: string; name: string } };

const TEST_PASSWORD = 'a-long-test-password';

/** Registers a user through the real API and keeps their login cookie. */
export async function signUp(app: TestApp, email: string, name = 'Test User'): Promise<Actor> {
  const res = await request(app)
    .post('/api/auth/register')
    .set('Origin', WEB_ORIGIN)
    .send({ email, password: TEST_PASSWORD, name });
  if (res.status !== 201)
    throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  const headers = res.headers['set-cookie'] as unknown as string[];
  const cookie = headers.find((h) => h.startsWith('fh_session='))?.split(';')[0] ?? '';
  return { cookie, user: res.body.user };
}

/** Makes requests AS a logged-in user, from our own web app's origin (like the real dashboard). */
export function actAs(app: TestApp, actor: Actor) {
  const withOrigin = (r: request.Test) => r.set('Cookie', actor.cookie).set('Origin', WEB_ORIGIN);
  return {
    get: (path: string) => withOrigin(request(app).get(path)),
    post: (path: string) => withOrigin(request(app).post(path)),
    patch: (path: string) => withOrigin(request(app).patch(path)),
    delete: (path: string) => withOrigin(request(app).delete(path)),
  };
}
