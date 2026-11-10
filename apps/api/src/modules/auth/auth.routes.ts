import { Router } from 'express';
import type { AppConfig } from '../../app.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { parse } from '../../lib/validate.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';
import { createRequireAuth } from '../../middleware/requireAuth.js';
import { requireTrustedOrigin } from '../../middleware/trustedOrigin.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import { authenticateUser, registerUser } from './auth.service.js';
import { createSession, deleteSession } from './session.service.js';
import {
  SESSION_COOKIE,
  readSessionToken,
  sessionCookieBase,
  sessionCookieOptions,
} from './sessionCookie.js';

export function createAuthRouter({ prisma, config }: { prisma: PrismaClient; config: AppConfig }) {
  const router = Router();
  const requireAuth = createRequireAuth(prisma);
  const cookieOptions = sessionCookieOptions(config.secureCookies);

  // Counts attempts per IP address. Shared by register and login.
  const limiter = createRateLimiter({
    windowMs: config.authRateLimit?.windowMs ?? 15 * 60 * 1000,
    limit: config.authRateLimit?.limit ?? 10,
  });

  router.use(requireTrustedOrigin(config.webOrigin));

  router.post('/register', limiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    const user = await registerUser(prisma, input);
    const session = await createSession(prisma, user.id);
    res.cookie(SESSION_COOKIE, session.token, cookieOptions);
    res.status(201).json({ user });
  });

  router.post('/login', limiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await authenticateUser(prisma, input);
    const session = await createSession(prisma, user.id);
    res.cookie(SESSION_COOKIE, session.token, cookieOptions);
    res.json({ user });
  });

  router.post('/logout', async (req, res) => {
    const token = readSessionToken(req);
    if (token) await deleteSession(prisma, token);
    res.clearCookie(SESSION_COOKIE, sessionCookieBase(config.secureCookies));
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
