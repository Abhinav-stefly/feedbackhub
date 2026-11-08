import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { actAs, buildApp, resetDatabase, signUp, type Actor } from '../../test/helpers.js';
import { MAX_ACTIVE_PROJECTS_PER_WORKSPACE } from '../workspaces/limits.js';

const app = buildApp();
let alice: Actor;
let workspaceId: string;

const projectsUrl = () => `/api/workspaces/${workspaceId}/projects`;
const createProject = (name = 'Web app') => actAs(app, alice).post(projectsUrl()).send({ name });

beforeEach(async () => {
  await resetDatabase();
  alice = await signUp(app, 'alice@example.com', 'Alice');
  const ws = await actAs(app, alice).post('/api/workspaces').send({ name: 'Acme' });
  workspaceId = ws.body.workspace.id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('creating projects', () => {
  it('creates a project with a random public key and a private roadmap by default', async () => {
    const res = await createProject('Web app');
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      name: 'Web app',
      workspaceId,
      roadmapPublic: false,
      archivedAt: null,
    });
    expect(res.body.project.publicKey).toMatch(/^pk_[A-Za-z0-9_-]{22}$/);
  });

  it('gives every project a different key', async () => {
    const a = await createProject('One');
    const b = await createProject('Two');
    expect(a.body.project.publicKey).not.toBe(b.body.project.publicKey);
  });

  it('refuses fields the client has no business setting', async () => {
    const res = await actAs(app, alice)
      .post(projectsUrl())
      .send({ name: 'Sneaky', publicKey: 'pk_chosen_by_attacker', roadmapPublic: true });
    expect(res.status).toBe(400);
    expect(await prisma.project.count()).toBe(0);
  });

  it(`stops at ${MAX_ACTIVE_PROJECTS_PER_WORKSPACE} active projects, and archiving frees a slot`, async () => {
    let firstId = '';
    for (let i = 0; i < MAX_ACTIVE_PROJECTS_PER_WORKSPACE; i++) {
      const res = await createProject(`P${i}`);
      expect(res.status).toBe(201);
      if (i === 0) firstId = res.body.project.id;
    }
    const over = await createProject('Too many');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');

    await actAs(app, alice).post(`/api/projects/${firstId}/archive`);
    expect((await createProject('Fits now')).status).toBe(201);
  });
});

describe('reading projects', () => {
  it('hides archived projects unless asked', async () => {
    const keep = await createProject('Keep');
    const drop = await createProject('Drop');
    await actAs(app, alice).post(`/api/projects/${drop.body.project.id}/archive`);

    const names = (r: { body: { projects: { name: string }[] } }) =>
      r.body.projects.map((p) => p.name);
    expect(names(await actAs(app, alice).get(projectsUrl()))).toEqual(['Keep']);
    expect(names(await actAs(app, alice).get(`${projectsUrl()}?includeArchived=true`))).toEqual([
      'Keep',
      'Drop',
    ]);
    expect((await actAs(app, alice).get(`${projectsUrl()}?includeArchived=maybe`)).status).toBe(
      400,
    );
    expect(keep.status).toBe(201);
  });

  it('returns one project together with your role', async () => {
    const created = await createProject();
    const res = await actAs(app, alice).get(`/api/projects/${created.body.project.id}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('OWNER');
    expect(res.body.project.id).toBe(created.body.project.id);
  });

  it('treats malformed ids as not found', async () => {
    expect((await actAs(app, alice).get('/api/projects/abc')).status).toBe(404);
    expect(
      (
        await actAs(app, alice).get(
          `/api/projects/${encodeURIComponent('1; DROP TABLE "Project";--')}`,
        )
      ).status,
    ).toBe(404);
    expect(await prisma.project.count()).toBe(0);
  });
});

describe('updating projects', () => {
  it('renames and changes roadmap visibility', async () => {
    const { body } = await createProject('Old');
    const url = `/api/projects/${body.project.id}`;

    const renamed = await actAs(app, alice).patch(url).send({ name: 'New' });
    expect(renamed.body.project.name).toBe('New');

    const published = await actAs(app, alice).patch(url).send({ roadmapPublic: true });
    expect(published.body.project.roadmapPublic).toBe(true);
    expect(published.body.project.name).toBe('New');
  });

  it('rejects an empty update', async () => {
    const { body } = await createProject();
    const res = await actAs(app, alice).patch(`/api/projects/${body.project.id}`).send({});
    expect(res.status).toBe(400);
  });

  it('cannot change the key, the workspace, or the id through the body', async () => {
    const { body } = await createProject();
    const before = body.project;
    for (const forbidden of [
      { publicKey: 'pk_new' },
      { workspaceId: crypto.randomUUID() },
      { id: crypto.randomUUID() },
    ]) {
      const res = await actAs(app, alice)
        .patch(`/api/projects/${before.id}`)
        .send({ name: 'x', ...forbidden });
      expect(res.status).toBe(400);
    }
    const after = await prisma.project.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({
      publicKey: before.publicKey,
      workspaceId: before.workspaceId,
      name: before.name,
    });
  });
});

describe('archiving', () => {
  it('archives and restores, and is safe to repeat', async () => {
    const { body } = await createProject();
    const id = body.project.id;

    const first = await actAs(app, alice).post(`/api/projects/${id}/archive`);
    expect(first.body.project.archivedAt).not.toBeNull();
    const again = await actAs(app, alice).post(`/api/projects/${id}/archive`);
    expect(again.status).toBe(200);
    expect(again.body.project.archivedAt).toBe(first.body.project.archivedAt);

    const restored = await actAs(app, alice).post(`/api/projects/${id}/unarchive`);
    expect(restored.body.project.archivedAt).toBeNull();
  });

  it('refuses to edit an archived project', async () => {
    const { body } = await createProject();
    await actAs(app, alice).post(`/api/projects/${body.project.id}/archive`);
    const res = await actAs(app, alice)
      .patch(`/api/projects/${body.project.id}`)
      .send({ name: 'Nope' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
  });
});
