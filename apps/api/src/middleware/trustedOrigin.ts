import type { RequestHandler } from 'express';
import { HttpError } from '../lib/httpError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence. Browsers attach the Origin header to every request that changes
 * data, and a malicious website cannot fake it. So for any request that is not
 * a plain read, the Origin must be exactly our own web app.
 */
export function requireTrustedOrigin(allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get('origin') === allowedOrigin) {
      next();
      return;
    }
    next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'Request origin is not allowed'));
  };
}
