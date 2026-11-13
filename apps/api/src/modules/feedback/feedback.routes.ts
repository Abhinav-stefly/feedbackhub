import { Router } from 'express';
import type { AppConfig } from '../../app.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { parse, parseId } from '../../lib/validate.js';
import { createRequireAuth, getUser } from '../../middleware/requireAuth.js';
import { requireTrustedOrigin } from '../../middleware/trustedOrigin.js';
import { assertCan } from '../workspaces/permissions.js';
import { addComment, listComments } from './comment.service.js';
import { getFeedbackAccess } from './feedback.access.js';
import { commentSchema, updateFeedbackSchema } from './feedback.schemas.js';
import { assertProjectActive, setFeedbackArchived, updateFeedback } from './feedback.service.js';

/** Routes for ONE feedback item: /api/feedback/:feedbackId (and its comments). */
export function createFeedbackRouter({
  prisma,
  config,
}: {
  prisma: PrismaClient;
  config: AppConfig;
}) {
  const router = Router();
  router.use(requireTrustedOrigin(config.webOrigin));
  router.use(createRequireAuth(prisma));

  const access = (req: Parameters<typeof getUser>[0]) =>
    getFeedbackAccess(prisma, getUser(req).id, parseId(req.params.feedbackId));

  router.get('/:feedbackId', async (req, res) => {
    const { feedback, role } = await access(req);
    res.json({ feedback, role });
  });

  router.patch('/:feedbackId', async (req, res) => {
    const { feedback, role, projectArchived } = await access(req); // 404 for outsiders
    const changes = parse(updateFeedbackSchema, req.body);

    // Which permission is needed depends on WHICH fields are being changed.
    const needsTriage =
      changes.status !== undefined ||
      changes.type !== undefined ||
      changes.title !== undefined ||
      changes.description !== undefined;
    if (needsTriage) assertCan(role, 'feedback:triage');
    if (changes.isPublic !== undefined) assertCan(role, 'feedback:publish');
    assertProjectActive(projectArchived);

    res.json({ feedback: await updateFeedback(prisma, feedback.id, changes), role });
  });

  router.post('/:feedbackId/archive', async (req, res) => {
    const { feedback, role, projectArchived } = await access(req);
    assertCan(role, 'feedback:archive');
    assertProjectActive(projectArchived);
    res.json({ feedback: await setFeedbackArchived(prisma, feedback, true), role });
  });

  router.post('/:feedbackId/unarchive', async (req, res) => {
    const { feedback, role, projectArchived } = await access(req);
    assertCan(role, 'feedback:archive');
    assertProjectActive(projectArchived);
    res.json({ feedback: await setFeedbackArchived(prisma, feedback, false), role });
  });

  // ---- internal comments: visible to the team only, never to the public API ----

  router.get('/:feedbackId/comments', async (req, res) => {
    const { feedback } = await access(req); // any member may read
    res.json({ comments: await listComments(prisma, feedback.id) });
  });

  router.post('/:feedbackId/comments', async (req, res) => {
    const { feedback, role, projectArchived } = await access(req);
    assertCan(role, 'feedback:comment');
    const { body } = parse(commentSchema, req.body);
    assertProjectActive(projectArchived);
    const comment = await addComment(prisma, feedback.id, getUser(req).id, body);
    res.status(201).json({ comment });
  });

  return router;
}
