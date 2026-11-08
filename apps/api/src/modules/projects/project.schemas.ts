import { z } from 'zod';

const name = z.string().trim().min(1).max(80);

// strictObject: any field we did not list (like "workspaceId" or "publicKey")
// is REJECTED, not silently accepted. This blocks "mass assignment" attacks.
export const createProjectSchema = z.strictObject({ name });

export const updateProjectSchema = z
  .strictObject({
    name: name.optional(),
    roadmapPublic: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field' });

export const listProjectsQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
