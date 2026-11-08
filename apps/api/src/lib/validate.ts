import { z } from 'zod';
import { HttpError, notFound } from './httpError.js';

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

/**
 * Validates an ID taken from the URL. Anything that is not a well-formed UUID gets the
 * SAME 404 as an ID that simply doesn't exist, so probing reveals nothing.
 */
export function parseId(value: unknown): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw notFound();
  return result.data;
}
