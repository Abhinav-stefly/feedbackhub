import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/httpError.js';
import { MAX_ACTIVE_PROJECTS_PER_WORKSPACE } from '../workspaces/limits.js';

/** The project fields the dashboard may see. */
export const projectSelect = {
  id: true,
  workspaceId: true,
  name: true,
  publicKey: true,
  roadmapPublic: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ProjectView = {
  id: string;
  workspaceId: string;
  name: string;
  publicKey: string;
  roadmapPublic: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The public key identifies a project to the embeddable widget. It is NOT a secret:
 * it sits in the HTML of the customer's website, and it grants no admin power.
 * 16 random bytes (128 bits) make it impossible to guess another project's key.
 */
export function generatePublicKey(): string {
  return `pk_${randomBytes(16).toString('base64url')}`;
}

export async function createProject(
  prisma: PrismaClient,
  workspaceId: string,
  name: string,
): Promise<ProjectView> {
  const active = await prisma.project.count({ where: { workspaceId, archivedAt: null } });
  if (active >= MAX_ACTIVE_PROJECTS_PER_WORKSPACE) {
    throw new HttpError(
      409,
      'LIMIT_REACHED',
      `A workspace can have at most ${MAX_ACTIVE_PROJECTS_PER_WORKSPACE} active projects`,
    );
  }
  return prisma.project.create({
    data: { workspaceId, name, publicKey: generatePublicKey() },
    select: projectSelect,
  });
}

export function listProjects(
  prisma: PrismaClient,
  workspaceId: string,
  includeArchived: boolean,
): Promise<ProjectView[]> {
  return prisma.project.findMany({
    where: { workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
    select: projectSelect,
    orderBy: { createdAt: 'asc' },
  });
}

export async function updateProject(
  prisma: PrismaClient,
  project: ProjectView,
  changes: { name?: string | undefined; roadmapPublic?: boolean | undefined },
): Promise<ProjectView> {
  if (project.archivedAt) {
    throw new HttpError(409, 'PROJECT_ARCHIVED', 'Restore this project before editing it');
  }
  return prisma.project.update({
    where: { id: project.id },
    data: {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.roadmapPublic !== undefined ? { roadmapPublic: changes.roadmapPublic } : {}),
    },
    select: projectSelect,
  });
}

/** Archiving is a "soft delete": the data stays, but the project goes quiet. Reversible. */
export async function setArchived(
  prisma: PrismaClient,
  project: ProjectView,
  archived: boolean,
): Promise<ProjectView> {
  if (archived === (project.archivedAt !== null)) return project; // already in that state

  if (!archived) {
    const active = await prisma.project.count({
      where: { workspaceId: project.workspaceId, archivedAt: null },
    });
    if (active >= MAX_ACTIVE_PROJECTS_PER_WORKSPACE) {
      throw new HttpError(409, 'LIMIT_REACHED', 'Too many active projects to restore this one');
    }
  }
  return prisma.project.update({
    where: { id: project.id },
    data: { archivedAt: archived ? new Date() : null },
    select: projectSelect,
  });
}
