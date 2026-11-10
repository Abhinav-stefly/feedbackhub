import { z } from 'zod';

/** Postgres cannot store the NUL character; an attacker could use it to trigger a server error. */
const noNulChars = (value: string) => !value.includes('\u0000');

// strictObject: customers may ONLY send these three fields. They can never set
// status, visibility, project, or anything else.
export const submitFeedbackSchema = z.strictObject({
  type: z.enum(['BUG', 'FEATURE', 'OTHER']),
  title: z.string().trim().min(3).max(120).refine(noNulChars, 'Contains invalid characters'),
  description: z
    .string()
    .trim()
    .min(10)
    .max(2000)
    .refine(noNulChars, 'Contains invalid characters'),
});

export const listPublicFeedbackQuerySchema = z.object({
  sort: z.enum(['votes', 'recent']).default('votes'),
  type: z.enum(['BUG', 'FEATURE', 'OTHER']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/** Public keys look like pk_ + 22 URL-safe characters. Anything else cannot exist. */
export const PUBLIC_KEY_PATTERN = /^pk_[A-Za-z0-9_-]{22}$/;

/** The widget invents a random ID per browser. 16-64 URL-safe characters. */
export const voterIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid voter id');
