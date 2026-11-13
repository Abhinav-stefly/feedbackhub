import type { PrismaClient, WorkspaceRole } from '../../generated/prisma/client.js';
import { HttpError, notFound } from '../../lib/httpError.js';
import { feedbackSelect, toFeedbackView, type FeedbackView } from './feedback.service.js';

export type FeedbackAccess = {
  feedback: FeedbackView;
  role: WorkspaceRole;
  projectArchived: boolean;
};

/**
 * Loads a feedback item ONLY IF the user belongs to the workspace that owns its project.
 * Three levels deep (user -> workspace -> project -> feedback), but still ONE query that
 * starts from the user's memberships, so a foreign item can never even be selected.
 * Not a member? The same 404 as "does not exist".
 */
export async function getFeedbackAccess(
  prisma: PrismaClient,
  userId: string,
  feedbackId: string,
): Promise<FeedbackAccess> {
  const mine = { feedback: { some: { id: feedbackId } } };
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { projects: { some: mine } } },
    select: {
      role: true,
      workspace: {
        select: {
          projects: {
            where: mine,
            select: {
              archivedAt: true,
              feedback: { where: { id: feedbackId }, select: feedbackSelect },
            },
          },
        },
      },
    },
  });
  const project = membership?.workspace.projects[0];
  const row = project?.feedback[0];
  if (!membership || !project || !row) throw notFound('Feedback not found');
  return {
    feedback: toFeedbackView(row),
    role: membership.role,
    projectArchived: project.archivedAt !== null,
  };
}

/** A comment is reachable only through the feedback item it belongs to (same membership rule). */
export async function getCommentAccess(prisma: PrismaClient, userId: string, commentId: string) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, feedbackId: true },
  });
  if (!comment) throw notFound('Comment not found');
  try {
    const access = await getFeedbackAccess(prisma, userId, comment.feedbackId);
    return { comment, role: access.role, projectArchived: access.projectArchived };
  } catch (err) {
    // Outsiders get the same 404 as "does not exist". Any OTHER failure (like a database
    // outage) must stay a real error, not be disguised as "not found".
    if (err instanceof HttpError && err.status === 404) throw notFound('Comment not found');
    throw err;
  }
}
