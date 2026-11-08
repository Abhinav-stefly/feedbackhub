import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas.js';

const name = z.string().trim().min(1).max(80);

export const createWorkspaceSchema = z.strictObject({ name });
export const updateWorkspaceSchema = z.strictObject({ name });

// Nobody can be ADDED as OWNER. The owner is whoever created the workspace.
export const addMemberSchema = z.strictObject({
  email: emailSchema,
  role: z.enum(['ADMIN', 'MEMBER']),
});
