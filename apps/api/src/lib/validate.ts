import type { z } from 'zod';
import { HttpError } from './httpError.js';

/**
 * Checks untrusted input against a Zod schema. On success you get clean,
 * correctly-typed data. On failure we throw a 400 listing WHICH fields are wrong
 * (never the values the user sent).
 */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', details);
  }
  return result.data;
}
