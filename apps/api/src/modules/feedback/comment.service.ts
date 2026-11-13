import type { PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/httpError.js';
import { MAX_COMMENTS_PER_FEEDBACK } from './limits.js';

export type CommentView = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string };
};

/** Authors are shown by NAME only. Emails and password hashes never leave the server. */
const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} as const;

export function listComments(prisma: PrismaClient, feedbackId: string): Promise<CommentView[]> {
  return prisma.comment.findMany({
    where: { feedbackId },
    select: commentSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function addComment(
  prisma: PrismaClient,
  feedbackId: string,
  authorId: string,
  body: string,
): Promise<CommentView> {
  const count = await prisma.comment.count({ where: { feedbackId } });
  if (count >= MAX_COMMENTS_PER_FEEDBACK) {
    throw new HttpError(
      409,
      'LIMIT_REACHED',
      `An item can have at most ${MAX_COMMENTS_PER_FEEDBACK} comments`,
    );
  }
  return prisma.comment.create({
    data: { feedbackId, authorId, body },
    select: commentSelect,
  });
}

export async function deleteComment(prisma: PrismaClient, commentId: string): Promise<void> {
  await prisma.comment.deleteMany({ where: { id: commentId } });
}
