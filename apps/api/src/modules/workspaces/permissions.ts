import type { WorkspaceRole } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/httpError.js';

/**
 * THE rulebook: who may do what. Every permission check in the app goes through
 * this one table, so the rules are easy to read, change and test.
 * (Simply READING a workspace's data is allowed for every member, so it is not listed.)
 */
const PERMISSIONS = {
  'workspace:update': ['OWNER', 'ADMIN'],
  'members:manage': ['OWNER', 'ADMIN'],
  'members:addAdmin': ['OWNER'],
  'members:removeAdmin': ['OWNER'],
  'project:create': ['OWNER', 'ADMIN'],
  'project:update': ['OWNER', 'ADMIN'],
  'project:archive': ['OWNER', 'ADMIN'],
  'project:setRoadmapVisibility': ['OWNER'],
  // Feedback: everyone on the team may READ and COMMENT; changing things is for admins and up.
  'feedback:comment': ['OWNER', 'ADMIN', 'MEMBER'],
  'feedback:triage': ['OWNER', 'ADMIN'], // status, type, title, description
  'feedback:publish': ['OWNER', 'ADMIN'], // show or hide an item on the public board
  'feedback:archive': ['OWNER', 'ADMIN'],
  'comment:moderate': ['OWNER', 'ADMIN'], // delete somebody else's comment
} as const satisfies Record<string, readonly WorkspaceRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly WorkspaceRole[]).includes(role);
}

/** Throws 403 when the role is not allowed. The caller is already known to be a member. */
export function assertCan(role: WorkspaceRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to do that');
  }
}
