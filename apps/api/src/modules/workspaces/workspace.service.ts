import { randomBytes } from 'node:crypto';
import type { PrismaClient, WorkspaceRole } from '../../generated/prisma/client.js';
import { HttpError, notFound } from '../../lib/httpError.js';
import { isUniqueViolation } from '../../lib/prismaErrors.js';
import { MAX_OWNED_WORKSPACES } from './limits.js';
import { assertCan } from './permissions.js';

const workspaceSelect = { id: true, name: true, slug: true, createdAt: true } as const;

export type WorkspaceView = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  role: WorkspaceRole;
};

export type MemberView = {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: Date;
};

/** "Acme Inc!" -> "acme-inc" (accents removed, symbols turned into dashes, max 40 chars). */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'workspace';
}

const makeSlug = (name: string) => `${slugify(name)}-${randomBytes(3).toString('hex')}`;

export async function createWorkspace(
  prisma: PrismaClient,
  userId: string,
  name: string,
): Promise<WorkspaceView> {
  const owned = await prisma.workspaceMember.count({ where: { userId, role: 'OWNER' } });
  if (owned >= MAX_OWNED_WORKSPACES) {
    throw new HttpError(
      409,
      'LIMIT_REACHED',
      `You can own at most ${MAX_OWNED_WORKSPACES} workspaces`,
    );
  }

  // The workspace and its first member (the owner) are created in ONE database
  // transaction: either both exist or neither does.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const workspace = await prisma.workspace.create({
        data: { name, slug: makeSlug(name), members: { create: { userId, role: 'OWNER' } } },
        select: workspaceSelect,
      });
      return { ...workspace, role: 'OWNER' };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // slug collision: try again with a new suffix
    }
  }
  throw new Error('Could not generate a unique workspace slug');
}

/** Only the workspaces this user belongs to. The membership IS the filter. */
export async function listWorkspaces(
  prisma: PrismaClient,
  userId: string,
): Promise<WorkspaceView[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { role: true, workspace: { select: workspaceSelect } },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}

export async function getWorkspace(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceView> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, workspace: { select: workspaceSelect } },
  });
  if (!membership) throw notFound('Workspace not found');
  return { ...membership.workspace, role: membership.role };
}

export function renameWorkspace(prisma: PrismaClient, workspaceId: string, name: string) {
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { name },
    select: workspaceSelect,
  });
}

export async function listMembers(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<MemberView[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    userId: r.user.id,
    email: r.user.email,
    name: r.user.name,
    role: r.role,
    joinedAt: r.createdAt,
  }));
}

export async function addMember(
  prisma: PrismaClient,
  workspaceId: string,
  actorRole: WorkspaceRole,
  input: { email: string; role: 'ADMIN' | 'MEMBER' },
): Promise<MemberView> {
  if (input.role === 'ADMIN') assertCan(actorRole, 'members:addAdmin');

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    throw new HttpError(
      404,
      'USER_NOT_FOUND',
      'No account exists with that email. Ask them to sign up first.',
    );
  }

  try {
    const member = await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: input.role },
      select: { role: true, createdAt: true },
    });
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: member.role,
      joinedAt: member.createdAt,
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'ALREADY_MEMBER', 'That person is already in this workspace');
    }
    throw err;
  }
}

export async function removeMember(
  prisma: PrismaClient,
  workspaceId: string,
  actorRole: WorkspaceRole,
  targetUserId: string,
): Promise<void> {
  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    select: { role: true },
  });
  if (!target) throw notFound('Member not found');

  if (target.role === 'OWNER') {
    throw new HttpError(403, 'CANNOT_REMOVE_OWNER', 'The workspace owner cannot be removed');
  }
  if (target.role === 'ADMIN') assertCan(actorRole, 'members:removeAdmin');

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });
}
