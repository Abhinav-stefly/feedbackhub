import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { actAs, buildApp, resetDatabase, signUp, type Actor } from '../test/helpers.js';

/**
 * THE WORLD
 *   Alice  OWNER  of Workspace A   (owns the "Secret roadmap" project)
 *   Dave   ADMIN  of Workspace A
 *   Eve    ADMIN  of Workspace A
 *   Carol  MEMBER of Workspace A
 *   Bob    OWNER  of Workspace B   (an OUTSIDER to Workspace A)
 */
const app = buildApp();
let alice: Actor, bob: Actor, carol: Actor, dave: Actor, eve: Actor;
let wa: string; // Workspace A
let wb: string; // Workspace B
let pa: string; // Project in Workspace A

beforeEach(async () => {
  await resetDatabase();
  [alice, bob, carol, dave, eve] = (await Promise.all([
    signUp(app, 'alice@example.com', 'Alice'),
    signUp(app, 'bob@example.com', 'Bob'),
    signUp(app, 'carol@example.com', 'Carol'),
    signUp(app, 'dave@example.com', 'Dave'),
    signUp(app, 'eve@example.com', 'Eve'),
  ])) as [Actor, Actor, Actor, Actor, Actor];

  const A = actAs(app, alice);
  wa = (await A.post('/api/workspaces').send({ name: 'Workspace A' })).body.workspace.id;
  wb = (await actAs(app, bob).post('/api/workspaces').send({ name: 'Workspace B' })).body.workspace
    .id;
  pa = (await A.post(`/api/workspaces/${wa}/projects`).send({ name: 'Secret roadmap' })).body
    .project.id;
  for (const [person, role] of [
    [carol, 'MEMBER'],
    [dave, 'ADMIN'],
    [eve, 'ADMIN'],
  ] as const) {
    await A.post(`/api/workspaces/${wa}/members`).send({ email: person.user.email, role });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Everything in the database that an attacker might try to change. */
async function snapshot() {
  return {
    workspaces: await prisma.workspace.findMany({ orderBy: { id: 'asc' } }),
    members: await prisma.workspaceMember.findMany({ orderBy: { id: 'asc' } }),
    projects: await prisma.project.findMany({ orderBy: { id: 'asc' } }),
  };
}

type Method = 'get' | 'post' | 'patch' | 'delete';
type Attempt = { label: string; method: Method; path: string; body?: object };
type Ids = { workspace: string; project: string; member: string };

/** Every route that touches one workspace or project. */
function everyRoute(ids: Ids): Attempt[] {
  const w = `/api/workspaces/${ids.workspace}`;
  const p = `/api/projects/${ids.project}`;
  return [
    { label: 'read workspace', method: 'get', path: w },
    { label: 'rename workspace', method: 'patch', path: w, body: { name: 'Hacked' } },
    { label: 'list projects', method: 'get', path: `${w}/projects` },
    { label: 'create project', method: 'post', path: `${w}/projects`, body: { name: 'Planted' } },
    { label: 'list members', method: 'get', path: `${w}/members` },
    {
      label: 'add a member',
      method: 'post',
      path: `${w}/members`,
      body: { email: 'bob@example.com', role: 'ADMIN' },
    },
    { label: 'remove a member', method: 'delete', path: `${w}/members/${ids.member}` },
    { label: 'read project', method: 'get', path: p },
    { label: 'rename project', method: 'patch', path: p, body: { name: 'Hacked' } },
    { label: 'publish roadmap', method: 'patch', path: p, body: { roadmapPublic: true } },
    { label: 'archive project', method: 'post', path: `${p}/archive` },
    { label: 'unarchive project', method: 'post', path: `${p}/unarchive` },
  ];
}

const send = (actor: Actor, a: Attempt) => {
  const r = actAs(app, actor)[a.method](a.path);
  return a.body ? r.send(a.body) : r;
};

describe('anonymous visitors', () => {
  it('are refused on every single route', async () => {
    for (const a of everyRoute({ workspace: wa, project: pa, member: carol.user.id })) {
      const pending = request(app)[a.method](a.path);
      const res = await pending.set('Origin', 'http://localhost:5173').send(a.body);
      expect(res.status, a.label).toBe(401);
    }
  });
});

describe('an outsider from another workspace (Bob vs Workspace A)', () => {
  it('gets "not found" on every route, and changes nothing', async () => {
    const before = await snapshot();
    for (const a of everyRoute({ workspace: wa, project: pa, member: carol.user.id })) {
      const res = await send(bob, a);
      expect(res.status, a.label).toBe(404);
      expect(JSON.stringify(res.body), a.label).not.toMatch(
        /Secret roadmap|Workspace A|alice|carol/i,
      );
    }
    expect(await snapshot()).toEqual(before);
  });

  it('cannot tell a real foreign ID from an ID that does not exist', async () => {
    const fake = {
      workspace: crypto.randomUUID(),
      project: crypto.randomUUID(),
      member: crypto.randomUUID(),
    };
    const real = everyRoute({ workspace: wa, project: pa, member: carol.user.id });
    const nothing = everyRoute(fake);
    for (const [i, a] of real.entries()) {
      const foreign = await send(bob, a);
      const missing = await send(bob, nothing[i] as Attempt);
      expect(foreign.status, a.label).toBe(missing.status);
      expect(foreign.body, a.label).toEqual(missing.body);
    }
  });

  it('only ever sees their own workspace in lists', async () => {
    const mine = await actAs(app, bob).get('/api/workspaces');
    expect(mine.body.workspaces.map((w: { id: string }) => w.id)).toEqual([wb]);
    const alices = await actAs(app, alice).get('/api/workspaces');
    expect(alices.body.workspaces.map((w: { id: string }) => w.id)).toEqual([wa]);
  });

  it('cannot reach a foreign member through their OWN workspace URL (ID mix-up)', async () => {
    // Carol belongs to A, not B. Bob owns B and tries to remove "carol from B".
    const res = await actAs(app, bob).delete(`/api/workspaces/${wb}/members/${carol.user.id}`);
    expect(res.status).toBe(404);
    expect(
      await prisma.workspaceMember.count({ where: { workspaceId: wa, userId: carol.user.id } }),
    ).toBe(1);
  });

  it('cannot plant a project in Workspace A by naming it in the body', async () => {
    const res = await actAs(app, bob)
      .post(`/api/workspaces/${wb}/projects`)
      .send({ name: 'Trojan', workspaceId: wa });
    expect(res.status).toBe(400);
    expect(await prisma.project.count({ where: { workspaceId: wa } })).toBe(1);
  });

  it('loses nothing and gains nothing from knowing the public key', async () => {
    const { publicKey } = await prisma.project.findUniqueOrThrow({ where: { id: pa } });
    expect((await actAs(app, bob).get(`/api/projects/${publicKey}`)).status).toBe(404);
    const asCookie = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `fh_session=${publicKey}`);
    expect(asCookie.status).toBe(401);
  });
});

describe('roles inside Workspace A', () => {
  describe('MEMBER (Carol): can look, cannot change', () => {
    it('can read everything', async () => {
      for (const a of everyRoute({ workspace: wa, project: pa, member: carol.user.id }).filter(
        (x) => x.method === 'get',
      )) {
        expect((await send(carol, a)).status, a.label).toBe(200);
      }
    });

    it('is forbidden from every change, and nothing changes', async () => {
      const before = await snapshot();
      for (const a of everyRoute({ workspace: wa, project: pa, member: dave.user.id }).filter(
        (x) => x.method !== 'get',
      )) {
        const res = await send(carol, a);
        expect(res.status, a.label).toBe(403);
        expect(res.body.error.code, a.label).toBe('FORBIDDEN');
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('ADMIN (Dave): manages projects, but not ownership-level things', () => {
    it('can create, rename and archive projects, and rename the workspace', async () => {
      const D = actAs(app, dave);
      const created = await D.post(`/api/workspaces/${wa}/projects`).send({ name: 'By Dave' });
      expect(created.status).toBe(201);
      const id = created.body.project.id;
      expect((await D.patch(`/api/projects/${id}`).send({ name: 'Renamed' })).status).toBe(200);
      expect((await D.post(`/api/projects/${id}/archive`)).status).toBe(200);
      expect((await D.patch(`/api/workspaces/${wa}`).send({ name: 'Renamed WS' })).status).toBe(
        200,
      );
    });

    it('can add MEMBERS and remove MEMBERS', async () => {
      const D = actAs(app, dave);
      expect(
        (
          await D.post(`/api/workspaces/${wa}/members`).send({
            email: 'bob@example.com',
            role: 'MEMBER',
          })
        ).status,
      ).toBe(201);
      expect((await D.delete(`/api/workspaces/${wa}/members/${carol.user.id}`)).status).toBe(204);
    });

    it('can NOT publish the roadmap, add admins, remove admins, or remove the owner', async () => {
      const D = actAs(app, dave);
      const before = await snapshot();
      expect((await D.patch(`/api/projects/${pa}`).send({ roadmapPublic: true })).status).toBe(403);
      expect(
        (
          await D.post(`/api/workspaces/${wa}/members`).send({
            email: 'bob@example.com',
            role: 'ADMIN',
          })
        ).status,
      ).toBe(403);
      expect((await D.delete(`/api/workspaces/${wa}/members/${eve.user.id}`)).status).toBe(403);
      const owner = await D.delete(`/api/workspaces/${wa}/members/${alice.user.id}`);
      expect(owner.status).toBe(403);
      expect(owner.body.error.code).toBe('CANNOT_REMOVE_OWNER');
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('OWNER (Alice): can do everything', () => {
    it('can publish the roadmap, add an admin and remove an admin', async () => {
      const A = actAs(app, alice);
      expect(
        (await A.patch(`/api/projects/${pa}`).send({ roadmapPublic: true })).body.project
          .roadmapPublic,
      ).toBe(true);
      expect(
        (
          await A.post(`/api/workspaces/${wa}/members`).send({
            email: 'bob@example.com',
            role: 'ADMIN',
          })
        ).status,
      ).toBe(201);
      expect((await A.delete(`/api/workspaces/${wa}/members/${eve.user.id}`)).status).toBe(204);
    });

    it('still cannot remove themselves as owner', async () => {
      const res = await actAs(app, alice).delete(`/api/workspaces/${wa}/members/${alice.user.id}`);
      expect(res.status).toBe(403);
    });
  });

  it('a removed member loses access to the workspace AND its projects at once', async () => {
    expect((await actAs(app, carol).get(`/api/projects/${pa}`)).status).toBe(200);
    await actAs(app, alice).delete(`/api/workspaces/${wa}/members/${carol.user.id}`);
    expect((await actAs(app, carol).get(`/api/projects/${pa}`)).status).toBe(404);
    expect((await actAs(app, carol).get(`/api/workspaces/${wa}/projects`)).status).toBe(404);
  });
});
