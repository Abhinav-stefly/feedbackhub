import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { actAs, buildApp, resetDatabase, signUp, type Actor } from '../../test/helpers.js';

const app = buildApp();
let alice: Actor;
let workspaceId: string;
let projectId: string;
let key: string;

const board = (k = key) => `/api/public/projects/${k}/feedback`;
const validBody = {
  type: 'FEATURE',
  title: 'Dark mode please',
  description: 'It would be great to have a dark theme.',
};
const submit = (body: object = validBody, a = app, k = key) => request(a).post(board(k)).send(body);
const voterId = (n: number) => `voter-${String(n).padStart(12, '0')}`;

/** Submits through the real public API, then (as the team would) marks it public. */
async function publicItem(title = 'A public idea', type = 'FEATURE') {
  const res = await submit({ ...validBody, title, type });
  const id = res.body.feedback.id as string;
  await prisma.feedback.update({ where: { id }, data: { isPublic: true } });
  return id;
}
const vote = (id: string, voter: number, a = app) =>
  request(a).put(`${board()}/${id}/vote`).set('X-Voter-Id', voterId(voter));

beforeEach(async () => {
  await resetDatabase();
  alice = await signUp(app, 'alice@example.com', 'Alice');
  const ws = await actAs(app, alice).post('/api/workspaces').send({ name: 'Acme' });
  workspaceId = ws.body.workspace.id;
  const pr = await actAs(app, alice)
    .post(`/api/workspaces/${workspaceId}/projects`)
    .send({ name: 'Web' });
  projectId = pr.body.project.id;
  key = pr.body.project.publicKey;
  await actAs(app, alice).patch(`/api/projects/${projectId}`).send({ roadmapPublic: true });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('submitting feedback', () => {
  it('stores it PRIVATE and "under review", and echoes back only safe fields', async () => {
    const res = await submit({ ...validBody, title: '  Dark mode please  ' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.feedback).sort()).toEqual(['createdAt', 'id', 'title', 'type']);

    const stored = await prisma.feedback.findUniqueOrThrow({ where: { id: res.body.feedback.id } });
    expect(stored).toMatchObject({
      projectId,
      title: 'Dark mode please',
      status: 'UNDER_REVIEW',
      isPublic: false,
      archivedAt: null,
    });
  });

  it('needs no cookie, no Origin header and no login', async () => {
    const res = await request(app).post(board()).send(validBody);
    expect(res.status).toBe(201);
  });

  it('ignores cookies completely and never sets one', async () => {
    const res = await request(app).post(board()).set('Cookie', alice.cookie).send(validBody);
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['an unknown type', { ...validBody, type: 'RANT' }, 'type'],
    ['a too-short title', { ...validBody, title: 'Hi' }, 'title'],
    ['a too-long title', { ...validBody, title: 'x'.repeat(121) }, 'title'],
    ['a too-short description', { ...validBody, description: 'short' }, 'description'],
    ['a too-long description', { ...validBody, description: 'x'.repeat(2001) }, 'description'],
    ['a NUL character in the title', { ...validBody, title: 'bad\u0000title' }, 'title'],
    ['a missing field', { type: 'BUG', title: 'No description here' }, 'description'],
  ])('rejects %s', async (_label, body, field) => {
    const res = await submit(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    expect(await prisma.feedback.count()).toBe(0);
  });

  it.each([
    ['status', { status: 'COMPLETED' }],
    ['isPublic', { isPublic: true }],
    ['projectId', { projectId: crypto.randomUUID() }],
    ['id', { id: crypto.randomUUID() }],
    ['createdAt', { createdAt: '2000-01-01T00:00:00Z' }],
  ])('refuses a customer who tries to set %s', async (_name, extra) => {
    const res = await submit({ ...validBody, ...extra });
    expect(res.status).toBe(400);
    expect(await prisma.feedback.count()).toBe(0);
  });

  it('rejects a body bigger than 10 KB, before it reaches any validation', async () => {
    const res = await submit({ ...validBody, description: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('stores HTML as plain text, and never serves it as a web page', async () => {
    const title = '<script>alert(1)</script>';
    const res = await submit({ ...validBody, title });
    expect(res.status).toBe(201);
    expect(res.body.feedback.title).toBe(title); // stored as-is: escaping happens when RENDERING
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('which keys work', () => {
  it('answers unknown, malformed and archived keys with the SAME 404', async () => {
    await actAs(app, alice).post(`/api/projects/${projectId}/archive`);
    const unknown = await submit(validBody, app, 'pk_' + 'A'.repeat(22));
    const malformed = await submit(validBody, app, 'not-a-key');
    const archived = await submit(validBody, app, key);
    for (const res of [unknown, malformed, archived]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    expect(await prisma.feedback.count()).toBe(0);
  });
});

describe("CORS: the widget runs on OTHER people's websites", () => {
  it('lets any website call, but with no credentials', async () => {
    const res = await request(app)
      .post(board())
      .set('Origin', 'https://some-customer-shop.example')
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers the browser preflight, including the voter header', async () => {
    const res = await request(app)
      .options(board())
      .set('Origin', 'https://some-customer-shop.example')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'content-type,x-voter-id');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-voter-id');
  });
});

describe('abuse protection', () => {
  it('rate-limits submissions per IP address', async () => {
    const limited = buildApp({ publicLimits: { submit: { windowMs: 60_000, limit: 2 } } });
    expect((await submit(validBody, limited)).status).toBe(201);
    expect((await submit(validBody, limited)).status).toBe(201);
    const blocked = await submit(validBody, limited);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(await prisma.feedback.count()).toBe(2);
  });

  it('caps total submissions per project per day, for ALL visitors combined', async () => {
    const capped = buildApp({ publicLimits: { dailySubmissionCapPerProject: 3 } });
    for (let i = 0; i < 3; i++) expect((await submit(validBody, capped)).status).toBe(201);
    const blocked = await submit(validBody, capped);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('SUBMISSION_LIMIT');

    // Another project is unaffected.
    const other = await actAs(app, alice)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .send({ name: 'Other' });
    expect((await submit(validBody, capped, other.body.project.publicKey)).status).toBe(201);
  });

  it('counts only the last 24 hours', async () => {
    const capped = buildApp({ publicLimits: { dailySubmissionCapPerProject: 1 } });
    await prisma.feedback.create({
      data: {
        projectId,
        type: 'BUG',
        title: 'Ancient',
        description: 'Submitted two days ago',
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    });
    expect((await submit(validBody, capped)).status).toBe(201);
    expect((await submit(validBody, capped)).status).toBe(429);
  });
});

describe('the public board (listing)', () => {
  it('shows ONLY items the team marked public, with nothing sensitive', async () => {
    const pub = await publicItem('Shown');
    await submit({ ...validBody, title: 'Private idea' }); // stays private
    const archived = await publicItem('Archived idea');
    await prisma.feedback.update({ where: { id: archived }, data: { archivedAt: new Date() } });

    const res = await request(app).get(board());
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([pub]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'createdAt',
      'description',
      'hasVoted',
      'id',
      'status',
      'title',
      'type',
      'voteCount',
    ]);
  });

  it('never leaks internal comments or team member details', async () => {
    const id = await publicItem('Has a note');
    await prisma.comment.create({
      data: { feedbackId: id, authorId: alice.user.id, body: 'INTERNAL-SECRET-NOTE' },
    });
    const text = JSON.stringify((await request(app).get(board())).body);
    expect(text).not.toContain('INTERNAL-SECRET-NOTE');
    expect(text).not.toMatch(/alice|Alice|@example\.com/);
  });

  it('is invisible (404) while the roadmap switch is off', async () => {
    await publicItem();
    await actAs(app, alice).patch(`/api/projects/${projectId}`).send({ roadmapPublic: false });
    const res = await request(app).get(board());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  });

  it("never mixes in another project's items", async () => {
    await publicItem('Mine');
    const other = await actAs(app, alice)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .send({ name: 'Other' });
    const otherKey = other.body.project.publicKey;
    await actAs(app, alice)
      .patch(`/api/projects/${other.body.project.id}`)
      .send({ roadmapPublic: true });
    const res = await request(app).get(board(otherKey));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('sorts by votes or recency, filters by type, and paginates', async () => {
    const a = await publicItem('A first', 'BUG');
    const b = await publicItem('B second');
    const c = await publicItem('C third');
    // Pin creation times so "most recent" is deterministic.
    for (const [i, id] of [a, b, c].entries()) {
      await prisma.feedback.update({
        where: { id },
        data: { createdAt: new Date(Date.now() - (3 - i) * 60_000) },
      });
    }
    await vote(b, 1);
    await vote(b, 2);
    await vote(c, 3);

    const ids = (r: request.Response) => r.body.items.map((i: { id: string }) => i.id);
    expect(ids(await request(app).get(`${board()}?sort=votes`))).toEqual([b, c, a]);
    expect(ids(await request(app).get(`${board()}?sort=recent`))).toEqual([c, b, a]);
    expect(ids(await request(app).get(`${board()}?type=BUG`))).toEqual([a]);

    const page2 = await request(app).get(`${board()}?sort=recent&pageSize=2&page=2`);
    expect(ids(page2)).toEqual([a]);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });

    for (const bad of ['pageSize=51', 'page=0', 'sort=random', 'type=RANT']) {
      expect((await request(app).get(`${board()}?${bad}`)).status, bad).toBe(400);
    }
  });
});

describe('voting', () => {
  it('counts a vote once, no matter how often the same visitor repeats it', async () => {
    const id = await publicItem();
    const first = await vote(id, 1);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ voted: true, voteCount: 1 });
    expect((await vote(id, 1)).body).toEqual({ voted: true, voteCount: 1 });
    expect((await vote(id, 2)).body).toEqual({ voted: true, voteCount: 2 });
  });

  it('can be taken back, safely and repeatedly', async () => {
    const id = await publicItem();
    await vote(id, 1);
    await vote(id, 2);
    const del = () => request(app).delete(`${board()}/${id}/vote`).set('X-Voter-Id', voterId(1));
    expect((await del()).body).toEqual({ voted: false, voteCount: 1 });
    expect((await del()).body).toEqual({ voted: false, voteCount: 1 });
  });

  it('tells each visitor which items THEY voted for', async () => {
    const a = await publicItem('Idea A');
    await publicItem('Idea B');
    await vote(a, 1);
    const mine = await request(app).get(board()).set('X-Voter-Id', voterId(1));
    const other = await request(app).get(board()).set('X-Voter-Id', voterId(2));
    const anon = await request(app).get(board());
    const flags = (r: request.Response) =>
      r.body.items.filter((i: { hasVoted: boolean }) => i.hasVoted).length;
    expect([flags(mine), flags(other), flags(anon)]).toEqual([1, 0, 0]);
  });

  it('requires a well-formed voter id', async () => {
    const id = await publicItem();
    const missing = await request(app).put(`${board()}/${id}/vote`);
    const malformed = await request(app).put(`${board()}/${id}/vote`).set('X-Voter-Id', 'short');
    const listBad = await request(app).get(board()).set('X-Voter-Id', 'bad id with spaces!!');
    expect([missing.status, malformed.status, listBad.status]).toEqual([400, 400, 400]);
    expect(await prisma.vote.count()).toBe(0);
  });

  it('stores only a fingerprint of the voter id', async () => {
    const id = await publicItem();
    await vote(id, 7);
    const [row] = await prisma.vote.findMany();
    expect(row?.voterKey).toBe(createHash('sha256').update(voterId(7)).digest('hex'));
    expect(row?.voterKey).not.toContain('voter-');
  });

  it('cannot vote on private, archived, foreign or missing items (all the same 404)', async () => {
    const privateItem = (await submit(validBody)).body.feedback.id as string;
    const archived = await publicItem('Archived');
    await prisma.feedback.update({ where: { id: archived }, data: { archivedAt: new Date() } });

    // An item that IS public, but belongs to a DIFFERENT project.
    const other = await actAs(app, alice)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .send({ name: 'Other' });
    await actAs(app, alice)
      .patch(`/api/projects/${other.body.project.id}`)
      .send({ roadmapPublic: true });
    const foreign = (await request(app).post(board(other.body.project.publicKey)).send(validBody))
      .body.feedback.id as string;
    await prisma.feedback.update({ where: { id: foreign }, data: { isPublic: true } });

    const bodies = [];
    for (const id of [privateItem, archived, foreign, crypto.randomUUID()]) {
      const res = await vote(id, 1);
      expect(res.status).toBe(404);
      bodies.push(res.body);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(await prisma.vote.count()).toBe(0);
  });

  it('is blocked while the public board is switched off', async () => {
    const id = await publicItem();
    await actAs(app, alice).patch(`/api/projects/${projectId}`).send({ roadmapPublic: false });
    expect((await vote(id, 1)).status).toBe(404);
  });

  it('survives 20 simultaneous identical votes: one vote, zero errors', async () => {
    const id = await publicItem();
    const results = await Promise.all(Array.from({ length: 20 }, () => vote(id, 1)));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    expect(await prisma.vote.count({ where: { feedbackId: id } })).toBe(1);
  });

  it('loses no votes when 20 DIFFERENT visitors vote at once', async () => {
    const id = await publicItem();
    await Promise.all(Array.from({ length: 20 }, (_, i) => vote(id, i + 1)));
    expect(await prisma.vote.count({ where: { feedbackId: id } })).toBe(20);
  });

  it('rate-limits voting per IP address', async () => {
    const id = await publicItem();
    const limited = buildApp({ publicLimits: { vote: { windowMs: 60_000, limit: 2 } } });
    expect((await vote(id, 1, limited)).status).toBe(200);
    expect((await vote(id, 2, limited)).status).toBe(200);
    expect((await vote(id, 3, limited)).status).toBe(429);
    expect(await prisma.vote.count()).toBe(2);
  });
});
