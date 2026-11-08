import { Router } from 'express';
import type { AppConfig } from '../../app.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { parse, parseId } from '../../lib/validate.js';
import { createRequireAuth, getUser } from '../../middleware/requireAuth.js';
import { requireTrustedOrigin } from '../../middleware/trustedOrigin.js';
import { getProjectAccess } from '../workspaces/access.js';
import { assertCan } from '../workspaces/permissions.js';
import { updateProjectSchema } from './project.schemas.js';
import { setArchived, updateProject } from './project.service.js';

/** Routes that address ONE project directly: /api/projects/:projectId */
export function createProjectsRouter({
  prisma,
  config,
}: {
  prisma: PrismaClient;
  config: AppConfig;
}) {
  const router = Router();
  router.use(requireTrustedOrigin(config.webOrigin));
  router.use(createRequireAuth(prisma));

  router.get('/:projectId', async (req, res) => {
    const { project, role } = await getProjectAccess(
      prisma,
      getUser(req).id,
      parseId(req.params.projectId),
    );
    res.json({ project, role });
  });

  router.patch('/:projectId', async (req, res) => {
    const { project, role } = await getProjectAccess(
      prisma,
      getUser(req).id,
      parseId(req.params.projectId),
    );
    const changes = parse(updateProjectSchema, req.body);

    if (changes.name !== undefined) assertCan(role, 'project:update');
    if (changes.roadmapPublic !== undefined) assertCan(role, 'project:setRoadmapVisibility');

    const updated = await updateProject(prisma, project, changes);
    res.json({ project: updated, role });
  });

  router.post('/:projectId/archive', async (req, res) => {
    const { project, role } = await getProjectAccess(
      prisma,
      getUser(req).id,
      parseId(req.params.projectId),
    );
    assertCan(role, 'project:archive');
    res.json({ project: await setArchived(prisma, project, true), role });
  });

  router.post('/:projectId/unarchive', async (req, res) => {
    const { project, role } = await getProjectAccess(
      prisma,
      getUser(req).id,
      parseId(req.params.projectId),
    );
    assertCan(role, 'project:archive');
    res.json({ project: await setArchived(prisma, project, false), role });
  });

  return router;
}
