import type {
  FeedbackStatus,
  FeedbackType,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/httpError.js';
import { escapeLike } from '../../lib/likeSearch.js';

/** Fields the dashboard may see about a feedback item, plus how many votes and comments it has. */
export const feedbackSelect = {
  id: true,
  projectId: true,
  type: true,
  status: true,
  title: true,
  description: true,
  isPublic: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { votes: true, comments: true } },
} as const;

type FeedbackRow = {
  id: string;
  projectId: string;
  type: FeedbackType;
  status: FeedbackStatus;
  title: string;
  description: string;
  isPublic: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { votes: number; comments: number };
};

export type FeedbackView = Omit<FeedbackRow, '_count'> & {
  voteCount: number;
  commentCount: number;
};

export function toFeedbackView(row: FeedbackRow): FeedbackView {
  const { _count, ...rest } = row;
  return { ...rest, voteCount: _count.votes, commentCount: _count.comments };
}

const EXCERPT_LENGTH = 200;

export type ListQuery = {
  status?: FeedbackStatus | undefined;
  type?: FeedbackType | undefined;
  visibility?: 'public' | 'private' | undefined;
  archived: 'active' | 'archived' | 'all';
  q?: string | undefined;
  sort: 'recent' | 'oldest' | 'updated' | 'votes';
  page: number;
  pageSize: number;
};

/** One page of a project's feedback. The projectId filter is ALWAYS applied. */
export async function listFeedback(prisma: PrismaClient, projectId: string, query: ListQuery) {
  const where: Prisma.FeedbackWhereInput = {
    projectId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.visibility ? { isPublic: query.visibility === 'public' } : {}),
    ...(query.archived === 'active' ? { archivedAt: null } : {}),
    ...(query.archived === 'archived' ? { archivedAt: { not: null } } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: escapeLike(query.q), mode: 'insensitive' } },
            { description: { contains: escapeLike(query.q), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.FeedbackOrderByWithRelationInput[] = {
    recent: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
    oldest: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    updated: [{ updatedAt: 'desc' as const }, { id: 'asc' as const }],
    votes: [
      { votes: { _count: 'desc' as const } },
      { createdAt: 'desc' as const },
      { id: 'asc' as const },
    ],
  }[query.sort];

  const [total, rows] = await prisma.$transaction([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: feedbackSelect,
    }),
  ]);

  const items = rows.map((row) => {
    const { description, ...view } = toFeedbackView(row);
    // Lists show a short excerpt; the detail view has the full text.
    const excerpt =
      description.length > EXCERPT_LENGTH
        ? `${description.slice(0, EXCERPT_LENGTH)}\u2026`
        : description;
    return { ...view, excerpt };
  });
  return { items, page: query.page, pageSize: query.pageSize, total };
}

export async function updateFeedback(
  prisma: PrismaClient,
  feedbackId: string,
  changes: {
    status?: FeedbackStatus | undefined;
    type?: FeedbackType | undefined;
    title?: string | undefined;
    description?: string | undefined;
    isPublic?: boolean | undefined;
  },
): Promise<FeedbackView> {
  const row = await prisma.feedback.update({
    where: { id: feedbackId },
    data: {
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.type !== undefined ? { type: changes.type } : {}),
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.isPublic !== undefined ? { isPublic: changes.isPublic } : {}),
    },
    select: feedbackSelect,
  });
  return toFeedbackView(row);
}

/** Soft delete: the item, its votes and its comments all stay; it just leaves every list. */
export async function setFeedbackArchived(
  prisma: PrismaClient,
  feedback: FeedbackView,
  archived: boolean,
): Promise<FeedbackView> {
  if (archived === (feedback.archivedAt !== null)) return feedback; // already in that state
  const row = await prisma.feedback.update({
    where: { id: feedback.id },
    data: { archivedAt: archived ? new Date() : null },
    select: feedbackSelect,
  });
  return toFeedbackView(row);
}

/** Writes are refused while the whole project is archived (restore it first). */
export function assertProjectActive(projectArchived: boolean): void {
  if (projectArchived) {
    throw new HttpError(
      409,
      'PROJECT_ARCHIVED',
      'Restore this project before changing its feedback',
    );
  }
}
