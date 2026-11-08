import { Router } from 'express';
import type { AppConfig } from '../../app.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { parse, parseId } from '../../lib/validate.js';
import { createRequireAuth, getUser } from '../../middleware/requireAuth.js';
import { requireTrustedOrigin } from '../../middleware/trustedOrigin.js';
import { createProjectSchema, listProjectsQuerySchema } from '../projects/project.schemas.js';
import { createProject, listProjects } from '../projects/project.service.js';
import { getWorkspaceRole } from './access.js';
import { assertCan } from './permissions.js';
import {
  addMemberSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
} from './workspace.schemas.js';
import {
  addMember,
  createWorkspace,
  getWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  renameWorkspace,
} from './workspace.service.js';

/** Routes under /api/workspaces. Pattern in every route: WHO is asking, WHAT role, THEN the work. */
export function createWorkspacesRouter({
  prisma,
  config,
}: {
  prisma: PrismaClient;
  config: AppConfig;
}) {
  const router = Router();
  router.use(requireTrustedOrigin(config.webOrigin));
  router.use(createRequireAuth(prisma));

  router.get('/', async (req, res) => {
    res.json({ workspaces: await listWorkspaces(prisma, getUser(req).id) });
  });

  router.post('/', async (req, res) => {
    const { name } = parse(createWorkspaceSchema, req.body);
    const workspace = await createWorkspace(prisma, getUser(req).id, name);
    res.status(201).json({ workspace });
  });

  router.get('/:workspaceId', async (req, res) => {
    const workspace = await getWorkspace(prisma, getUser(req).id, parseId(req.params.workspaceId));
    res.json({ workspace });
  });

  router.patch('/:workspaceId', async (req, res) => {
    const userId = getUser(req).id;
    const workspaceId = parseId(req.params.workspaceId);
    assertCan(await getWorkspaceRole(prisma, userId, workspaceId), 'workspace:update');
    const { name } = parse(updateWorkspaceSchema, req.body);
    await renameWorkspace(prisma, workspaceId, name);
    res.json({ workspace: await getWorkspace(prisma, userId, workspaceId) });
  });

  // ---- projects inside a workspace ----

  router.get('/:workspaceId/projects', async (req, res) => {
    const workspaceId = parseId(req.params.workspaceId);
    await getWorkspaceRole(prisma, getUser(req).id, workspaceId); // members only
    const { includeArchived } = parse(listProjectsQuerySchema, req.query);
    res.json({ projects: await listProjects(prisma, workspaceId, includeArchived) });
  });

  router.post('/:workspaceId/projects', async (req, res) => {
    const workspaceId = parseId(req.params.workspaceId);
    assertCan(await getWorkspaceRole(prisma, getUser(req).id, workspaceId), 'project:create');
    const { name } = parse(createProjectSchema, req.body);
    res.status(201).json({ project: await createProject(prisma, workspaceId, name) });
  });

  // ---- members ----

  router.get('/:workspaceId/members', async (req, res) => {
    const workspaceId = parseId(req.params.workspaceId);
    await getWorkspaceRole(prisma, getUser(req).id, workspaceId); // members only
    res.json({ members: await listMembers(prisma, workspaceId) });
  });

  router.post('/:workspaceId/members', async (req, res) => {
    const workspaceId = parseId(req.params.workspaceId);
    const role = await getWorkspaceRole(prisma, getUser(req).id, workspaceId);
    assertCan(role, 'members:manage');
    const input = parse(addMemberSchema, req.body);
    res.status(201).json({ member: await addMember(prisma, workspaceId, role, input) });
  });

  router.delete('/:workspaceId/members/:userId', async (req, res) => {
    const workspaceId = parseId(req.params.workspaceId);
    const role = await getWorkspaceRole(prisma, getUser(req).id, workspaceId);
    assertCan(role, 'members:manage');
    await removeMember(prisma, workspaceId, role, parseId(req.params.userId));
    res.status(204).end();
  });

  return router;
}
