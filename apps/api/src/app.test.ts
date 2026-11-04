import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

// A fake "database is healthy" check. No real database needed for these tests.
const app = createApp({ checkDatabase: async () => {} });

describe('GET /api/health', () => {
  it('returns 200 and a status payload', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /api/health/ready', () => {
  it('returns 200 when the database check passes', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('returns 503 when the database check fails, hiding the real error', async () => {
    const broken = createApp({
      checkDatabase: async () => {
        throw new Error('password authentication failed for user "feedbackhub"');
      },
    });
    const res = await request(broken).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' },
    });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('error handling', () => {
  it('returns a consistent JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('rejects bodies over the size limit with 413', async () => {
    const res = await request(app)
      .post('/api/anything')
      .send({ blob: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with 400, without leaking parser details', async () => {
    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Malformed request' } });
  });
});

describe('loadEnv', () => {
  const valid = {
    WEB_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  };

  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('fails loudly on invalid values without echoing them', () => {
    expect(() => loadEnv({ WEB_ORIGIN: 'not-a-url', PORT: 'abc' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a DATABASE_URL that is not a postgres URL, without echoing it', () => {
    const attempt = () => loadEnv({ ...valid, DATABASE_URL: 'mysql://secret-user:secret-pw@h/db' });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).not.toThrow(/secret-pw/);
  });
});
