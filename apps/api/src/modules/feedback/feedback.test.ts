import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  WEB_ORIGIN,
  actAs,
  buildApp,
  resetDatabase,
  signUp,
  type Actor,
} from '../../test/helpers.js';
import { MAX_COMMENTS_PER_FEEDBACK } from './limits.js';

/**
 * THE WORLD
 *   Alice OWNER, Dave ADMIN, Carol MEMBER of Workspace A (project PA, public board ON)
 *   Bob   OWNER of Workspace B (an OUTSIDER to everything in A)
 */
const app = buildApp();
let alice: Actor, bob: Actor, carol: Actor, dave: Actor;
let wa: string, pa: string, publicKey: string, pb: string;

type Seed = Partial<{
  title: string;
  description: string;
  type: 'BUG' | 'FEATURE' | 'OTHER';
  status: 'UNDER_REVIEW' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
  isPublic: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  projectId: string;
}>;

const makeFeedback = (over: Seed = {}) =>
  prisma.feedback.create({
    data: {
      projectId: pa,
      type: 'FEATURE',
      title: 'Untitled idea',
      description: 'A description that is long enough.',
      ...over,
    },
  });

beforeEach(async () => {
  await resetDatabase();
  [alice, bob, carol, dave] = (await Promise.all([
    signUp(app, 'alice@example.com', 'Alice'),
    signUp(app, 'bob@example.com', 'Bob'),
    signUp(app, 'carol@example.com', 'Carol'),
    signUp(app, 'dave@example.com', 'Dave'),
  ])) as [Actor, Actor, Actor, Actor];

  const A = actAs(app, alice);
  wa = (await A.post('/api/workspaces').send({ name: 'Workspace A' })).body.workspace.id;
  const project = (await A.post(`/api/workspaces/${wa}/projects`).send({ name: 'Web' })).body
    .project;
  pa = project.id;
  publicKey = project.publicKey;
  await A.patch(`/api/projects/${pa}`).send({ roadmapPublic: true });
  for (const [person, role] of [
    [carol, 'MEMBER'],
    [dave, 'ADMIN'],
  ] as const) {
    await A.post(`/api/workspaces/${wa}/members`).send({ email: person.user.email, role });
  }
  const wb = (await actAs(app, bob).post('/api/workspaces').send({ name: 'Workspace B' })).body
    .workspace.id;
  pb = (await actAs(app, bob).post(`/api/workspaces/${wb}/projects`).send({ name: 'Other' })).body
    .project.id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const inbox = (actor: Actor, query = '', project = pa) =>
  actAs(app, actor).get(`/api/projects/${project}/feedback${query}`);
const titles = (res: request.Response) => res.body.items.map((i: { title: string }) => i.title);
const publicBoard = () => request(app).get(`/api/public/projects/${publicKey}/feedback`);

describe('the inbox (list, filter, search, sort, pages)', () => {
  it('returns a page of items with counts, a short excerpt, and no full description', async () => {
    const long = 'x'.repeat(500);
    const item = await makeFeedback({ title: 'Long one', description: long });
    await prisma.vote.createMany({
      data: [
        { feedbackId: item.id, voterKey: 'a' },
        { feedbackId: item.id, voterKey: 'b' },
      ],
    });
    await prisma.comment.create({
      data: { feedbackId: item.id, authorId: alice.user.id, body: 'note' },
    });

    const res = await inbox(alice);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    const row = res.body.items[0];
    expect(row).toMatchObject({
      title: 'Long one',
      voteCount: 2,
      commentCount: 1,
      status: 'UNDER_REVIEW',
      isPublic: false,
    });
    expect(row.excerpt).toBe('x'.repeat(200) + '\u2026');
    expect(row).not.toHaveProperty('description');
  });

  it('hides archived items unless asked', async () => {
    await makeFeedback({ title: 'Active one' });
    await makeFeedback({ title: 'Archived one', archivedAt: new Date() });
    expect(titles(await inbox(alice))).toEqual(['Active one']);
    expect(titles(await inbox(alice, '?archived=archived'))).toEqual(['Archived one']);
    expect((titles(await inbox(alice, '?archived=all')) as string[]).sort()).toEqual([
      'Active one',
      'Archived one',
    ]);
  });

  it('filters by status, type and visibility, and combines filters', async () => {
    await makeFeedback({
      title: 'Planned feature',
      status: 'PLANNED',
      type: 'FEATURE',
      isPublic: true,
    });
    await makeFeedback({ title: 'Planned bug', status: 'PLANNED', type: 'BUG' });
    await makeFeedback({ title: 'Review feature', type: 'FEATURE' });
    expect(titles(await inbox(alice, '?status=PLANNED&sort=oldest'))).toEqual([
      'Planned feature',
      'Planned bug',
    ]);
    expect(titles(await inbox(alice, '?type=BUG'))).toEqual(['Planned bug']);
    expect(titles(await inbox(alice, '?visibility=public'))).toEqual(['Planned feature']);
    expect(titles(await inbox(alice, '?status=PLANNED&type=FEATURE&visibility=public'))).toEqual([
      'Planned feature',
    ]);
  });

  it('searches titles and descriptions, ignoring case', async () => {
    await makeFeedback({ title: 'Dark Mode please', description: 'Easier on the eyes at night.' });
    await makeFeedback({ title: 'Export', description: 'Let me export to CSV for DARK reasons.' });
    await makeFeedback({ title: 'Unrelated', description: 'Nothing to see here at all.' });
    expect((titles(await inbox(alice, '?q=dark')) as string[]).sort()).toEqual([
      'Dark Mode please',
      'Export',
    ]);
    expect(titles(await inbox(alice, '?q=CSV'))).toEqual(['Export']);
  });

  it('treats % and _ in a search as ordinary text, not as wildcards', async () => {
    await makeFeedback({ title: 'Grow 100% faster' });
    await makeFeedback({ title: 'Grow 1000 faster' });
    await makeFeedback({ title: 'snake_case names' });
    await makeFeedback({ title: 'snakeXcase names' });
    expect(titles(await inbox(alice, `?q=${encodeURIComponent('100%')}`))).toEqual([
      'Grow 100% faster',
    ]);
    expect(titles(await inbox(alice, `?q=${encodeURIComponent('snake_')}`))).toEqual([
      'snake_case names',
    ]);
    expect(titles(await inbox(alice, `?q=${encodeURIComponent('%')}`))).toEqual([
      'Grow 100% faster',
    ]);
  });

  it('treats an empty search as no search, and rejects a NUL character in it', async () => {
    await makeFeedback({ title: 'Something' });
    expect(titles(await inbox(alice, '?q='))).toEqual(['Something']);
    expect((await inbox(alice, '?q=bad%00text')).status).toBe(400);
  });

  it('sorts by newest, oldest, most recently updated, and most votes', async () => {
    const day = 24 * 60 * 60 * 1000;
    const a = await makeFeedback({ title: 'A', createdAt: new Date(Date.now() - 3 * day) });
    const b = await makeFeedback({ title: 'B', createdAt: new Date(Date.now() - 2 * day) });
    await makeFeedback({ title: 'C', createdAt: new Date(Date.now() - 1 * day) });
    await prisma.vote.createMany({
      data: [
        { feedbackId: b.id, voterKey: '1' },
        { feedbackId: b.id, voterKey: '2' },
        { feedbackId: a.id, voterKey: '3' },
      ],
    });
    await prisma.feedback.update({ where: { id: a.id }, data: { title: 'A' } }); // touches updatedAt
    expect(titles(await inbox(alice, '?sort=recent'))).toEqual(['C', 'B', 'A']);
    expect(titles(await inbox(alice, '?sort=oldest'))).toEqual(['A', 'B', 'C']);
    expect(titles(await inbox(alice, '?sort=votes'))).toEqual(['B', 'A', 'C']);
    expect(titles(await inbox(alice, '?sort=updated'))[0]).toBe('A');
  });

  it('paginates, and refuses nonsense parameters', async () => {
    for (let i = 1; i <= 5; i++) {
      await makeFeedback({ title: `Item ${i}`, createdAt: new Date(Date.now() - i * 1000) });
    }
    const page2 = await inbox(alice, '?pageSize=2&page=2');
    expect(titles(page2)).toEqual(['Item 3', 'Item 4']);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    for (const bad of [
      'pageSize=101',
      'pageSize=0',
      'page=0',
      'sort=random',
      'status=MAYBE',
      'type=RANT',
      'archived=some',
      'visibility=secret',
    ]) {
      expect((await inbox(alice, `?${bad}`)).status, bad).toBe(400);
    }
  });

  it("only ever shows THIS project's items", async () => {
    await makeFeedback({ title: 'In A' });
    const second = (
      await actAs(app, alice).post(`/api/workspaces/${wa}/projects`).send({ name: 'Second' })
    ).body.project.id;
    await makeFeedback({ title: 'In second project', projectId: second });
    expect(titles(await inbox(alice))).toEqual(['In A']);
    expect(titles(await inbox(alice, '', second))).toEqual(['In second project']);
  });

  it('is readable by every member, and invisible to outsiders and anonymous visitors', async () => {
    await makeFeedback({ title: 'Secret roadmap idea' });
    expect((await inbox(carol)).status).toBe(200);
    const outsider = await inbox(bob);
    expect(outsider.status).toBe(404);
    expect(JSON.stringify(outsider.body)).not.toContain('Secret roadmap idea');
    expect(outsider.body).toEqual((await inbox(bob, '', crypto.randomUUID())).body); // same as "does not exist"
    expect((await request(app).get(`/api/projects/${pa}/feedback`)).status).toBe(401);
  });
});

describe('one item (detail)', () => {
  it('returns the full text, counts and your role', async () => {
    const item = await makeFeedback({ title: 'Detail me', description: 'y'.repeat(500) });
    const res = await actAs(app, carol).get(`/api/feedback/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('MEMBER');
    expect(res.body.feedback).toMatchObject({
      id: item.id,
      title: 'Detail me',
      voteCount: 0,
      commentCount: 0,
    });
    expect(res.body.feedback.description).toHaveLength(500);
  });

  it('answers an outsider exactly as it answers a missing id', async () => {
    const item = await makeFeedback();
    const foreign = await actAs(app, bob).get(`/api/feedback/${item.id}`);
    const missing = await actAs(app, bob).get(`/api/feedback/${crypto.randomUUID()}`);
    const malformed = await actAs(app, bob).get('/api/feedback/not-a-uuid');
    expect([foreign.status, missing.status, malformed.status]).toEqual([404, 404, 404]);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe('triage: changing an item', () => {
  it('lets an admin change status, type, title and description (trimmed), keeping votes', async () => {
    const item = await makeFeedback({ title: 'Before title' });
    await prisma.vote.create({ data: { feedbackId: item.id, voterKey: 'v' } });
    const res = await actAs(app, dave).patch(`/api/feedback/${item.id}`).send({
      status: 'IN_PROGRESS',
      type: 'BUG',
      title: '  After title  ',
      description: '  A corrected description.  ',
    });
    expect(res.status).toBe(200);
    expect(res.body.feedback).toMatchObject({
      status: 'IN_PROGRESS',
      type: 'BUG',
      title: 'After title',
      description: 'A corrected description.',
      voteCount: 1,
    });
    expect(new Date(res.body.feedback.updatedAt).getTime()).toBeGreaterThan(
      item.updatedAt.getTime(),
    );
  });

  it('forbids a plain member from changing anything, leaving the item untouched', async () => {
    const item = await makeFeedback();
    const before = await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } });
    for (const body of [
      { status: 'DECLINED' },
      { title: 'Hijacked title' },
      { isPublic: true },
      { type: 'BUG' },
    ]) {
      const res = await actAs(app, carol).patch(`/api/feedback/${item.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
    }
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } })).toEqual(before);
  });

  it('refuses fields nobody may set, and invalid values', async () => {
    const item = await makeFeedback();
    const before = await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } });
    const bodies = [
      { projectId: pb },
      { archivedAt: null },
      { id: crypto.randomUUID() },
      { createdAt: '2000-01-01T00:00:00Z' },
      { voteCount: 999 },
      {},
      { status: 'MAYBE' },
      { title: 'x' },
      { title: 'ok title', description: 'short' },
      { isPublic: 'yes' },
    ];
    for (const body of bodies) {
      expect(
        (await actAs(app, alice).patch(`/api/feedback/${item.id}`).send(body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } })).toEqual(before);
  });

  it('rejects a valid change that smuggles in a forbidden field, applying NONE of it', async () => {
    // Each body has a perfectly good field next to a forbidden one. If forbidden fields were
    // merely ignored, the good part would be applied; we want the whole request refused.
    const item = await makeFeedback();
    const before = await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } });
    const smuggled = [
      { status: 'PLANNED', projectId: pb },
      { title: 'A perfectly valid title', archivedAt: null },
      { isPublic: true, voteCount: 999 },
      { type: 'BUG', id: crypto.randomUUID() },
    ];
    for (const body of smuggled) {
      const res = await actAs(app, alice).patch(`/api/feedback/${item.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } })).toEqual(before);
  });

  it('gives an outsider "not found" and changes nothing', async () => {
    const item = await makeFeedback();
    const before = await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } });
    const res = await actAs(app, bob)
      .patch(`/api/feedback/${item.id}`)
      .send({ status: 'COMPLETED', isPublic: true });
    expect(res.status).toBe(404);
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } })).toEqual(before);
  });

  it('blocks changes from another website (CSRF), and from anonymous visitors', async () => {
    const item = await makeFeedback();
    const forged = await request(app)
      .patch(`/api/feedback/${item.id}`)
      .set('Cookie', alice.cookie)
      .set('Origin', 'https://evil.example')
      .send({ status: 'DECLINED' });
    expect(forged.status).toBe(403);
    const anon = await request(app)
      .patch(`/api/feedback/${item.id}`)
      .set('Origin', 'http://localhost:5173')
      .send({ status: 'DECLINED' });
    expect(anon.status).toBe(401);
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'UNDER_REVIEW',
    );
  });
});

describe('archiving an item', () => {
  it('lets admins archive and restore (safely repeatable), and keeps votes and comments', async () => {
    const item = await makeFeedback({ title: 'Archive me' });
    await prisma.vote.create({ data: { feedbackId: item.id, voterKey: 'v' } });
    await prisma.comment.create({
      data: { feedbackId: item.id, authorId: alice.user.id, body: 'keep me' },
    });
    const D = actAs(app, dave);

    const first = await D.post(`/api/feedback/${item.id}/archive`);
    expect(first.body.feedback.archivedAt).not.toBeNull();
    const again = await D.post(`/api/feedback/${item.id}/archive`);
    expect(again.body.feedback.archivedAt).toBe(first.body.feedback.archivedAt);
    expect(titles(await inbox(alice))).toEqual([]);
    expect(await prisma.vote.count()).toBe(1);
    expect(await prisma.comment.count()).toBe(1);

    const restored = await D.post(`/api/feedback/${item.id}/unarchive`);
    expect(restored.body.feedback.archivedAt).toBeNull();
    expect(titles(await inbox(alice))).toEqual(['Archive me']);
  });

  it('forbids members and outsiders', async () => {
    const item = await makeFeedback();
    expect((await actAs(app, carol).post(`/api/feedback/${item.id}/archive`)).status).toBe(403);
    expect((await actAs(app, bob).post(`/api/feedback/${item.id}/archive`)).status).toBe(404);
    expect(
      (await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } })).archivedAt,
    ).toBeNull();
  });
});

describe('publishing, end to end with the PUBLIC API', () => {
  it('shows an item to customers only while it is public, active, and the board is on', async () => {
    const item = await makeFeedback({ title: 'Customers want this' });
    const A = actAs(app, dave); // an admin may publish

    expect((await publicBoard()).body.items).toEqual([]); // new feedback is private

    await A.patch(`/api/feedback/${item.id}`).send({ isPublic: true });
    const shown = (await publicBoard()).body.items;
    expect(shown.map((i: { id: string }) => i.id)).toEqual([item.id]);
    expect(shown[0].status).toBe('UNDER_REVIEW');

    await A.patch(`/api/feedback/${item.id}`).send({ status: 'PLANNED' });
    expect((await publicBoard()).body.items[0].status).toBe('PLANNED'); // status changes reach customers

    await A.post(`/api/feedback/${item.id}/archive`);
    expect((await publicBoard()).body.items).toEqual([]); // archived: gone from the public board

    await A.post(`/api/feedback/${item.id}/unarchive`);
    expect((await publicBoard()).body.items).toHaveLength(1);

    await A.patch(`/api/feedback/${item.id}`).send({ isPublic: false });
    expect((await publicBoard()).body.items).toEqual([]); // hidden again
  });

  it('lets customers vote on a published item, and the team sees the count', async () => {
    const item = await makeFeedback();
    await actAs(app, alice).patch(`/api/feedback/${item.id}`).send({ isPublic: true });
    const voted = await request(app)
      .put(`/api/public/projects/${publicKey}/feedback/${item.id}/vote`)
      .set('X-Voter-Id', 'customer-abcdefghijkl');
    expect(voted.body.voteCount).toBe(1);
    expect((await actAs(app, carol).get(`/api/feedback/${item.id}`)).body.feedback.voteCount).toBe(
      1,
    );
  });

  it('NEVER exposes internal comments or team details to the public', async () => {
    const item = await makeFeedback({ title: 'Has internal notes' });
    await actAs(app, alice).patch(`/api/feedback/${item.id}`).send({ isPublic: true });
    await actAs(app, carol)
      .post(`/api/feedback/${item.id}/comments`)
      .send({ body: 'INTERNAL-ONLY-NOTE: customer is difficult' });

    const board = await publicBoard();
    const text = JSON.stringify(board.body);
    expect(text).toContain('Has internal notes');
    expect(text).not.toMatch(/INTERNAL-ONLY-NOTE|difficult|Carol|Alice|@example\.com/);
    const vote = await request(app)
      .put(`/api/public/projects/${publicKey}/feedback/${item.id}/vote`)
      .set('X-Voter-Id', 'customer-abcdefghijkl');
    expect(JSON.stringify(vote.body)).not.toContain('INTERNAL-ONLY-NOTE');
  });

  it('lets only admins publish', async () => {
    const item = await makeFeedback();
    expect(
      (await actAs(app, carol).patch(`/api/feedback/${item.id}`).send({ isPublic: true })).status,
    ).toBe(403);
    expect((await publicBoard()).body.items).toEqual([]);
  });
});

describe('internal comments', () => {
  it('lets any member comment, shows author NAMES only, in order', async () => {
    const item = await makeFeedback();
    const first = await actAs(app, carol)
      .post(`/api/feedback/${item.id}/comments`)
      .send({ body: '  First note  ' });
    expect(first.status).toBe(201);
    expect(first.body.comment).toMatchObject({
      body: 'First note',
      author: { id: carol.user.id, name: 'Carol' },
    });
    await actAs(app, dave).post(`/api/feedback/${item.id}/comments`).send({ body: 'Second note' });

    const list = await actAs(app, alice).get(`/api/feedback/${item.id}/comments`);
    expect(list.body.comments.map((c: { body: string }) => c.body)).toEqual([
      'First note',
      'Second note',
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(/@example\.com|passwordHash|argon2/);
    expect(
      (await actAs(app, alice).get(`/api/feedback/${item.id}`)).body.feedback.commentCount,
    ).toBe(2);
  });

  it.each([
    ['an empty comment', { body: '   ' }],
    ['a too-long comment', { body: 'x'.repeat(2001) }],
    ['a NUL character', { body: 'bad\u0000text' }],
    ['extra fields (like a fake author)', { body: 'hello', authorId: crypto.randomUUID() }],
    ['no body at all', {}],
  ])('rejects %s', async (_label, body) => {
    const item = await makeFeedback();
    expect(
      (await actAs(app, carol).post(`/api/feedback/${item.id}/comments`).send(body)).status,
    ).toBe(400);
    expect(await prisma.comment.count()).toBe(0);
  });

  it('keeps outsiders out of reading AND writing comments', async () => {
    const item = await makeFeedback();
    await prisma.comment.create({
      data: { feedbackId: item.id, authorId: alice.user.id, body: 'private words' },
    });
    const read = await actAs(app, bob).get(`/api/feedback/${item.id}/comments`);
    const write = await actAs(app, bob)
      .post(`/api/feedback/${item.id}/comments`)
      .send({ body: 'sneaky' });
    expect([read.status, write.status]).toEqual([404, 404]);
    expect(JSON.stringify(read.body)).not.toContain('private words');
    expect(await prisma.comment.count()).toBe(1);
  });

  it(`stops at ${MAX_COMMENTS_PER_FEEDBACK} comments per item`, async () => {
    const item = await makeFeedback();
    await prisma.comment.createMany({
      data: Array.from({ length: MAX_COMMENTS_PER_FEEDBACK }, (_, i) => ({
        feedbackId: item.id,
        authorId: alice.user.id,
        body: `note ${i}`,
      })),
    });
    const over = await actAs(app, alice)
      .post(`/api/feedback/${item.id}/comments`)
      .send({ body: 'one too many' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
  });

  describe('deleting', () => {
    async function noteBy(author: Actor) {
      const item = await makeFeedback();
      const res = await actAs(app, author)
        .post(`/api/feedback/${item.id}/comments`)
        .send({ body: 'a note' });
      return { item, commentId: res.body.comment.id as string };
    }

    it('lets people delete their own comment, and nobody delete it twice', async () => {
      const { commentId } = await noteBy(carol);
      expect((await actAs(app, carol).delete(`/api/comments/${commentId}`)).status).toBe(204);
      expect((await actAs(app, carol).delete(`/api/comments/${commentId}`)).status).toBe(404);
    });

    it("stops a member deleting a colleague's comment, but lets admins and owners", async () => {
      const mine = await noteBy(dave); // written by an admin
      expect((await actAs(app, carol).delete(`/api/comments/${mine.commentId}`)).status).toBe(403);
      expect(await prisma.comment.count()).toBe(1);

      const hers = await noteBy(carol);
      expect((await actAs(app, dave).delete(`/api/comments/${hers.commentId}`)).status).toBe(204);
      expect((await actAs(app, alice).delete(`/api/comments/${mine.commentId}`)).status).toBe(204);
      expect(await prisma.comment.count()).toBe(0);
    });

    it('treats outsiders and bad ids as "not found"', async () => {
      const { commentId } = await noteBy(carol);
      expect((await actAs(app, bob).delete(`/api/comments/${commentId}`)).status).toBe(404);
      expect((await actAs(app, bob).delete(`/api/comments/${crypto.randomUUID()}`)).status).toBe(
        404,
      );
      expect((await actAs(app, alice).delete('/api/comments/nope')).status).toBe(404);
      expect(await prisma.comment.count()).toBe(1);
    });
  });
});

describe('an archived project is read-only for feedback', () => {
  it('still lets the team read, but refuses every change', async () => {
    const item = await makeFeedback({ title: 'Frozen' });
    const note = await prisma.comment.create({
      data: { feedbackId: item.id, authorId: alice.user.id, body: 'old note' },
    });
    await actAs(app, alice).post(`/api/projects/${pa}/archive`);
    const A = actAs(app, alice);

    expect((await A.get(`/api/feedback/${item.id}`)).status).toBe(200);
    expect((await A.get(`/api/feedback/${item.id}/comments`)).status).toBe(200);
    expect((await inbox(alice)).status).toBe(200);

    const attempts = [
      await A.patch(`/api/feedback/${item.id}`).send({ status: 'PLANNED' }),
      await A.post(`/api/feedback/${item.id}/archive`),
      await A.post(`/api/feedback/${item.id}/comments`).send({ body: 'new note' }),
      await A.delete(`/api/comments/${note.id}`),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'UNDER_REVIEW',
    );
    expect(await prisma.comment.count()).toBe(1);
  });
});

describe('when the database fails mid-request', () => {
  it('answers with a server error, never disguised as "not found"', async () => {
    const item = await makeFeedback();
    const note = await prisma.comment.create({
      data: { feedbackId: item.id, authorId: alice.user.id, body: 'a note' },
    });
    // A copy of the database client whose membership lookup suddenly breaks.
    const failing = new Proxy(prisma, {
      get(target, prop) {
        if (prop === 'workspaceMember') {
          return {
            findFirst: async () => {
              throw new Error('connection lost');
            },
          };
        }
        return Reflect.get(target, prop, target);
      },
    });
    const brokenApp = createApp({
      checkDatabase: async () => {},
      prisma: failing,
      config: { webOrigin: WEB_ORIGIN, secureCookies: false },
    });

    const res = await actAs(brokenApp, alice).delete(`/api/comments/${note.id}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(await prisma.comment.count()).toBe(1);
  });
});
