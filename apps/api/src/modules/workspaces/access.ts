import type { PrismaClient, WorkspaceRole } from '../../generated/prisma/client.js';
import { notFound } from '../../lib/httpError.js';
import { projectSelect, type ProjectView } from '../projects/project.service.js';

/**
 * Finds out what role this user has in this workspace. If they are NOT a member,
 * we answer 404 ("not found"), exactly as if the workspace did not exist. A 403
 * would confirm that the workspace is real, which helps someone guessing IDs.
 */
export async function getWorkspaceRole(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!membership) throw notFound('Workspace not found');
  return membership.role;
}

/**
 * Loads a project ONLY IF the user belongs to its workspace, in a single query.
 * We start from the user's MEMBERSHIPS and reach the project through them, so a
 * project that belongs to someone else's workspace can never even be selected.
 */
export async function getProjectAccess(
  prisma: PrismaClient,
  userId: string,
  projectId: string,
): Promise<{ project: ProjectView; role: WorkspaceRole }> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { projects: { some: { id: projectId } } } },
    select: {
      role: true,
      workspace: { select: { projects: { where: { id: projectId }, select: projectSelect } } },
    },
  });
  const project = membership?.workspace.projects[0];
  if (!membership || !project) throw notFound('Project not found');
  return { project, role: membership.role };
}
