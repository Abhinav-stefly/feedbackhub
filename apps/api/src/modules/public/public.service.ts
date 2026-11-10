import type { FeedbackStatus, FeedbackType, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError, notFound } from '../../lib/httpError.js';
import { PUBLIC_KEY_PATTERN } from './public.schemas.js';

export type PublicFeedbackItem = {
  id: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  voteCount: number;
  hasVoted: boolean;
  createdAt: Date;
};

/**
 * Finds the project behind a public key. Unknown keys, malformed keys and ARCHIVED
 * projects all give the identical 404, so nobody can probe which keys exist.
 */
export async function findPublicProject(prisma: PrismaClient, publicKey: unknown) {
  if (typeof publicKey !== 'string' || !PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw notFound('Project not found');
  }
  const project = await prisma.project.findUnique({
    where: { publicKey },
    select: { id: true, roadmapPublic: true, archivedAt: true },
  });
  if (!project || project.archivedAt) throw notFound('Project not found');
  return project;
}

/** The public board (list + voting) exists only if the team switched the roadmap on. Otherwise: the same 404. */
export function requirePublicBoard(project: { roadmapPublic: boolean }): void {
  if (!project.roadmapPublic) throw notFound('Project not found');
}

export async function submitFeedback(
  prisma: PrismaClient,
  projectId: string,
  input: { type: FeedbackType; title: string; description: string },
  dailyCap: number,
) {
  // A cap per project protects the database from a flood spread across many IP addresses.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.feedback.count({ where: { projectId, createdAt: { gte: since } } });
  if (recent >= dailyCap) {
    throw new HttpError(
      429,
      'SUBMISSION_LIMIT',
      'This project is receiving too much feedback right now. Please try again later.',
    );
  }

  // New feedback is ALWAYS private and "under review". Only the team can publish it.
  return prisma.feedback.create({
    data: { projectId, type: input.type, title: input.title, description: input.description },
    select: { id: true, type: true, title: true, createdAt: true },
  });
}

export async function listPublicFeedback(
  prisma: PrismaClient,
  projectId: string,
  query: {
    sort: 'votes' | 'recent';
    type?: FeedbackType | undefined;
    page: number;
    pageSize: number;
  },
  voterHash: string | undefined,
) {
  // The ONLY items that can ever appear: explicitly public, not archived, in this project.
  const where = {
    projectId,
    isPublic: true,
    archivedAt: null,
    ...(query.type ? { type: query.type } : {}),
  };
  const orderBy =
    query.sort === 'votes'
      ? [
          { votes: { _count: 'desc' as const } },
          { createdAt: 'desc' as const },
          { id: 'asc' as const },
        ]
      : [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

  const [total, rows] = await prisma.$transaction([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        _count: { select: { votes: true } },
      },
    }),
  ]);

  const votedIds = new Set<string>();
  if (voterHash && rows.length > 0) {
    const mine = await prisma.vote.findMany({
      where: { voterKey: voterHash, feedbackId: { in: rows.map((r) => r.id) } },
      select: { feedbackId: true },
    });
    for (const vote of mine) votedIds.add(vote.feedbackId);
  }

  const items: PublicFeedbackItem[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    description: r.description,
    status: r.status,
    voteCount: r._count.votes,
    hasVoted: votedIds.has(r.id),
    createdAt: r.createdAt,
  }));
  return { items, page: query.page, pageSize: query.pageSize, total };
}

/** A vote is only allowed on an item that is public, not archived, and in THIS project. */
async function requireVotableFeedback(prisma: PrismaClient, projectId: string, feedbackId: string) {
  const feedback = await prisma.feedback.findFirst({
    where: { id: feedbackId, projectId, isPublic: true, archivedAt: null },
    select: { id: true },
  });
  if (!feedback) throw notFound('Feedback not found');
}

/** Idempotent: voting twice is the same as voting once. */
export async function castVote(
  prisma: PrismaClient,
  projectId: string,
  feedbackId: string,
  voterHash: string,
) {
  await requireVotableFeedback(prisma, projectId, feedbackId);
  // "INSERT ... ON CONFLICT DO NOTHING": the database's unique rule settles any race.
  await prisma.vote.createMany({
    data: [{ feedbackId, voterKey: voterHash }],
    skipDuplicates: true,
  });
  return { voted: true, voteCount: await prisma.vote.count({ where: { feedbackId } }) };
}

export async function removeVote(
  prisma: PrismaClient,
  projectId: string,
  feedbackId: string,
  voterHash: string,
) {
  await requireVotableFeedback(prisma, projectId, feedbackId);
  await prisma.vote.deleteMany({ where: { feedbackId, voterKey: voterHash } });
  return { voted: false, voteCount: await prisma.vote.count({ where: { feedbackId } }) };
}
