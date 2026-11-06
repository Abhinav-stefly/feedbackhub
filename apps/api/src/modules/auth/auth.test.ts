import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { WEB_ORIGIN, buildApp, resetDatabase } from '../../test/helpers.js';

const app = buildApp();
const creds = { email: 'ada@example.com', password: 'correct horse battery', name: 'Ada' };

type TestApp = ReturnType<typeof buildApp>;

/** POST as if from our own web app (browsers send the Origin header). */
const post = (path: string, a: TestApp = app) => request(a).post(path).set('Origin', WEB_ORIGIN);

const register = (body: object = creds, a: TestApp = app) =>
  post('/api/auth/register', a).send(body);

/** Pulls the raw session Set-Cookie header out of a response. */
function setCookieHeader(res: request.Response): string {
  const headers = res.headers['set-cookie'] as unknown as string[] | undefined;
  const header = headers?.find((h) => h.startsWith('fh_session='));
  if (!header) throw new Error('No session cookie was set');
  return header;
}

/** "fh_session=abc" : the part a browser sends back. */
const cookiePair = (res: request.Response) => setCookieHeader(res).split(';')[0] ?? '';

beforeEach(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates an account, logs the user in, and returns only safe fields', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.user).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    expect(res.body.user.email).toBe('ada@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.com' } });
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored.passwordHash).not.toContain(creds.password);
  });

  it('sets a locked-down cookie', async () => {
    const header = setCookieHeader(await register());
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure'); // only switched on in production
  });

  it('marks the cookie Secure when configured for production', async () => {
    const secureApp = buildApp({ secureCookies: true });
    expect(setCookieHeader(await register(creds, secureApp))).toContain('Secure');
  });

  it('treats emails case-insensitively and trims spaces', async () => {
    await register({ ...creds, email: '  ADA@Example.COM ' });
    const stored = await prisma.user.findMany();
    expect(stored.map((u) => u.email)).toEqual(['ada@example.com']);

    const again = await register({ ...creds, email: 'Ada@example.com' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('lets exactly one of several simultaneous sign-ups for one email win', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => register()));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ['a too-short password', { ...creds, password: 'short' }, 'password'],
    ['an absurdly long password', { ...creds, password: 'x'.repeat(129) }, 'password'],
    ['an invalid email', { ...creds, email: 'not-an-email' }, 'email'],
    ['a missing name', { email: creds.email, password: creds.password }, 'name'],
  ])('rejects %s with field-level details', async (_label, body, field) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    expect(JSON.stringify(res.body)).not.toContain(creds.password);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects a request with no body at all', async () => {
    const res = await post('/api/auth/register');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('logs in with the right password', async () => {
    const res = await post('/api/auth/login').send({
      email: 'ADA@example.com',
      password: creds.password,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ada@example.com');
    expect(setCookieHeader(res)).toContain('HttpOnly');
  });

  it('gives the SAME error for a wrong password and an unknown email', async () => {
    const wrongPassword = await post('/api/auth/login').send({
      email: creds.email,
      password: 'nope-nope-nope',
    });
    const unknownEmail = await post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'nope-nope-nope',
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('sessions', () => {
  it('GET /api/auth/me returns the logged-in user', async () => {
    const reg = await register();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookiePair(reg));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ada@example.com');
  });

  it('rejects /me without a cookie, and with a made-up one', async () => {
    const none = await request(app).get('/api/auth/me');
    const fake = await request(app).get('/api/auth/me').set('Cookie', 'fh_session=totally-made-up');
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('UNAUTHENTICATED');
    expect(fake.status).toBe(401);
  });

  it('stores only a SHA-256 fingerprint of the token, never the token', async () => {
    const reg = await register();
    const token = cookiePair(reg).split('=')[1] ?? '';
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(sessions[0]?.tokenHash).not.toBe(token);
  });

  it('rejects an expired session and deletes it', async () => {
    const reg = await register();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).get('/api/auth/me').set('Cookie', cookiePair(reg));
    expect(res.status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('logout destroys the session on the server, not just in the browser', async () => {
    const reg = await register();
    const cookie = cookiePair(reg);
    const out = await post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(await prisma.session.count()).toBe(0);

    // Even a thief who copied the old cookie is now locked out.
    const after = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('logout without a session is harmless', async () => {
    const res = await post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

describe('CSRF and CORS protection', () => {
  it('blocks state-changing requests with no Origin header', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('blocks state-changing requests from another website', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('allows reading without an Origin header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401); // reached the auth check, not blocked as foreign
  });

  it('answers the browser preflight for our own web app, with credentials', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never grants CORS access to another website', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('rate limiting', () => {
  it('blocks repeated attempts from one address with 429', async () => {
    const limited = buildApp({ authRateLimit: { windowMs: 60_000, limit: 3 } });
    const attempt = () =>
      post('/api/auth/login', limited).send({
        email: 'x@example.com',
        password: 'guess-guess-guess',
      });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
