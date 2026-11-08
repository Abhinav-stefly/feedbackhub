import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { actAs, buildApp, resetDatabase, signUp, type Actor } from '../../test/helpers.js';
import { MAX_OWNED_WORKSPACES } from './limits.js';
import { slugify } from './workspace.service.js';

const app = buildApp();
let alice: Actor;
let bob: Actor;

beforeEach(async () => {
  await resetDatabase();
  alice = await signUp(app, 'alice@example.com', 'Alice');
  bob = await signUp(app, 'bob@example.com', 'Bob');
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('slugify', () => {
  it.each([
    ['Acme Inc!', 'acme-inc'],
    ['Café Crème', 'cafe-creme'],
    ['  --Hello   World--  ', 'hello-world'],
    ['!!!', 'workspace'],
  ])('turns %j into %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('caps the length and never ends with a dash', () => {
    const slug = slugify('word '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('creating and listing workspaces', () => {
  it('requires login', async () => {
    expect((await request(app).get('/api/workspaces')).status).toBe(401);
  });

  it('creates a workspace and makes the creator its OWNER', async () => {
    const res = await actAs(app, alice).post('/api/workspaces').send({ name: 'Acme Inc' });
    expect(res.status).toBe(201);
    expect(res.body.workspace.role).toBe('OWNER');
    expect(res.body.workspace.slug).toMatch(/^acme-inc-[0-9a-f]{6}$/);

    const members = await prisma.workspaceMember.findMany();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: alice.user.id, role: 'OWNER' });
  });

  it('lets two workspaces share a name (slugs stay unique)', async () => {
    const a = await actAs(app, alice).post('/api/workspaces').send({ name: 'Same' });
    const b = await actAs(app, bob).post('/api/workspaces').send({ name: 'Same' });
    expect(a.body.workspace.slug).not.toBe(b.body.workspace.slug);
  });

  it('lists only the workspaces you belong to', async () => {
    await actAs(app, alice).post('/api/workspaces').send({ name: 'Alice Co' });
    await actAs(app, bob).post('/api/workspaces').send({ name: 'Bob Co' });
    const res = await actAs(app, alice).get('/api/workspaces');
    expect(res.body.workspaces.map((w: { name: string }) => w.name)).toEqual(['Alice Co']);
  });

  it('rejects empty names, long names, and fields it did not ask for', async () => {
    const a = actAs(app, alice);
    expect((await a.post('/api/workspaces').send({ name: '   ' })).status).toBe(400);
    expect((await a.post('/api/workspaces').send({ name: 'x'.repeat(81) })).status).toBe(400);
    const extra = await a.post('/api/workspaces').send({ name: 'Ok', slug: 'my-own-slug' });
    expect(extra.status).toBe(400);
    expect(await prisma.workspace.count()).toBe(0);
  });

  it(`stops at ${MAX_OWNED_WORKSPACES} owned workspaces`, async () => {
    const a = actAs(app, alice);
    for (let i = 0; i < MAX_OWNED_WORKSPACES; i++) {
      expect((await a.post('/api/workspaces').send({ name: `WS ${i}` })).status).toBe(201);
    }
    const over = await a.post('/api/workspaces').send({ name: 'One too many' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
  });

  it('blocks creating workspaces from another website (CSRF)', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Cookie', alice.cookie)
      .set('Origin', 'https://evil.example')
      .send({ name: 'Sneaky' });
    expect(res.status).toBe(403);
    expect(await prisma.workspace.count()).toBe(0);
  });
});

describe('reading and renaming', () => {
  it('lets the owner rename, and treats a malformed id as not found', async () => {
    const a = actAs(app, alice);
    const created = await a.post('/api/workspaces').send({ name: 'Old name' });
    const id = created.body.workspace.id;

    const renamed = await a.patch(`/api/workspaces/${id}`).send({ name: 'New name' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.workspace.name).toBe('New name');

    expect((await a.get('/api/workspaces/not-a-uuid')).status).toBe(404);
    expect((await a.get(`/api/workspaces/${encodeURIComponent("1' OR '1'='1")}`)).status).toBe(404);
  });
});

describe('members', () => {
  let workspaceId: string;
  beforeEach(async () => {
    const created = await actAs(app, alice).post('/api/workspaces').send({ name: 'Team' });
    workspaceId = created.body.workspace.id;
  });
  const members = () => `/api/workspaces/${workspaceId}/members`;

  it('adds an existing user, and lists everyone with their roles', async () => {
    const added = await actAs(app, alice)
      .post(members())
      .send({ email: 'BOB@example.com', role: 'MEMBER' });
    expect(added.status).toBe(201);
    expect(added.body.member).toMatchObject({ email: 'bob@example.com', role: 'MEMBER' });

    const list = await actAs(app, alice).get(members());
    expect(list.body.members.map((m: { role: string }) => m.role).sort()).toEqual([
      'MEMBER',
      'OWNER',
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('rejects duplicates, unknown emails, and attempts to add an OWNER', async () => {
    const a = actAs(app, alice);
    await a.post(members()).send({ email: 'bob@example.com', role: 'MEMBER' });

    const dup = await a.post(members()).send({ email: 'bob@example.com', role: 'MEMBER' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');

    const unknown = await a.post(members()).send({ email: 'ghost@example.com', role: 'MEMBER' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('USER_NOT_FOUND');

    const owner = await a.post(members()).send({ email: 'bob@example.com', role: 'OWNER' });
    expect(owner.status).toBe(400);
  });

  it('lets exactly one of several simultaneous identical invitations win', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        actAs(app, alice).post(members()).send({ email: 'bob@example.com', role: 'MEMBER' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.workspaceMember.count({ where: { workspaceId } })).toBe(2);
  });

  it('removes a member, who immediately loses access', async () => {
    await actAs(app, alice).post(members()).send({ email: 'bob@example.com', role: 'MEMBER' });
    expect((await actAs(app, bob).get(`/api/workspaces/${workspaceId}`)).status).toBe(200);

    const removed = await actAs(app, alice).delete(`${members()}/${bob.user.id}`);
    expect(removed.status).toBe(204);
    expect((await actAs(app, bob).get(`/api/workspaces/${workspaceId}`)).status).toBe(404);
  });

  it('never allows removing the owner', async () => {
    const res = await actAs(app, alice).delete(`${members()}/${alice.user.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_REMOVE_OWNER');
  });
});
