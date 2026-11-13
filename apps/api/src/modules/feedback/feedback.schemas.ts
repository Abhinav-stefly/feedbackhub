import { z } from 'zod';
import { noNulChars } from '../../lib/textRules.js';

const status = z.enum(['UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED']);
const type = z.enum(['BUG', 'FEATURE', 'OTHER']);

export const listFeedbackQuerySchema = z.object({
  status: status.optional(),
  type: type.optional(),
  visibility: z.enum(['public', 'private']).optional(),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  q: z
    .string()
    .trim()
    .max(100)
    .refine(noNulChars, 'Contains invalid characters')
    .optional()
    .transform((value) => value || undefined), // "" means "no search"
  sort: z.enum(['recent', 'oldest', 'updated', 'votes']).default('recent'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// strictObject: only these fields can ever be changed. Project, dates, id, archive state and
// vote counts are NOT here, so they cannot be touched through this route.
export const updateFeedbackSchema = z
  .strictObject({
    status: status.optional(),
    type: type.optional(),
    title: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .refine(noNulChars, 'Contains invalid characters')
      .optional(),
    description: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .refine(noNulChars, 'Contains invalid characters')
      .optional(),
    isPublic: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field' });

export const commentSchema = z.strictObject({
  body: z.string().trim().min(1).max(2000).refine(noNulChars, 'Contains invalid characters'),
});
