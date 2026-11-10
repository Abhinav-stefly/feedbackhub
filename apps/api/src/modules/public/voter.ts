import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { HttpError } from '../../lib/httpError.js';
import { voterIdSchema } from './public.schemas.js';

const HEADER = 'x-voter-id';

function validationError(message: string) {
  return new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [
    { field: 'X-Voter-Id', message },
  ]);
}

/** The anonymous voter ID from the X-Voter-Id header, if the widget sent one. Malformed = error. */
export function optionalVoterId(req: Request): string | undefined {
  const raw = req.get(HEADER);
  if (raw === undefined) return undefined;
  const parsed = voterIdSchema.safeParse(raw);
  if (!parsed.success) throw validationError('Must be 16-64 letters, digits, "-" or "_"');
  return parsed.data;
}

/** Same, but voting requires it. */
export function requireVoterId(req: Request): string {
  const voterId = optionalVoterId(req);
  if (voterId === undefined) throw validationError('Header is required');
  return voterId;
}

/** We store a fingerprint of the voter ID, never the ID itself. */
export function hashVoterId(voterId: string): string {
  return createHash('sha256').update(voterId).digest('hex');
}
