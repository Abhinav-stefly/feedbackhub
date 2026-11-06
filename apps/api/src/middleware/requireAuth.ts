import type { RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../lib/httpError.js';
import { findUserBySessionToken } from '../modules/auth/session.service.js';
import { readSessionToken } from '../modules/auth/sessionCookie.js';

/** Put this in front of any route that needs a logged-in user. It sets `req.user`. */
export function createRequireAuth(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const token = readSessionToken(req);
    const user = token ? await findUserBySessionToken(prisma, token) : null;
    if (!user) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    req.user = user;
    next();
  };
}
