import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const app = createApp();

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
  it('applies defaults', () => {
    const env = loadEnv({ WEB_ORIGIN: 'http://localhost:5173' });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('fails loudly on invalid values without echoing them', () => {
    expect(() => loadEnv({ WEB_ORIGIN: 'not-a-url', PORT: 'abc' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});