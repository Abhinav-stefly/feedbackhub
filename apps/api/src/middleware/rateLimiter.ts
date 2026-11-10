import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../lib/httpError.js';

export interface RateLimitOptions {
  /** Length of the counting window, in milliseconds. */
  windowMs: number;
  /** How many requests one IP address may make inside the window. */
  limit: number;
}

/** Counts requests per IP address and answers 429 once the limit is passed. */
export function createRateLimiter({ windowMs, limit }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.')),
  });
}
