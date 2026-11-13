import { Router } from 'express';
import type { AppConfig } from '../../app.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/httpError.js';
import { parseId } from '../../lib/validate.js';
import { createRequireAuth, getUser } from '../../middleware/requireAuth.js';
import { requireTrustedOrigin } from '../../middleware/trustedOrigin.js';
import { can } from '../workspaces/permissions.js';
import { deleteComment } from './comment.service.js';
import { getCommentAccess } from './feedback.access.js';
import { assertProjectActive } from './feedback.service.js';

/** Routes for ONE comment: /api/comments/:commentId */
export function createCommentsRouter({
  prisma,
  config,
}: {
  prisma: PrismaClient;
  config: AppConfig;
}) {
  const router = Router();
  router.use(requireTrustedOrigin(config.webOrigin));
  router.use(createRequireAuth(prisma));

  router.delete('/:commentId', async (req, res) => {
    const user = getUser(req);
    const { comment, role, projectArchived } = await getCommentAccess(
      prisma,
      user.id,
      parseId(req.params.commentId),
    );
    // You may delete your OWN comments; admins and owners may delete anyone's.
    const allowed = comment.authorId === user.id || can(role, 'comment:moderate');
    if (!allowed) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to do that');
    assertProjectActive(projectArchived);
    await deleteComment(prisma, comment.id);
    res.status(204).end();
  });

  return router;
}
