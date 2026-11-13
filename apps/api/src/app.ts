import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { PrismaClient } from './generated/prisma/client.js';
import { HttpError } from './lib/httpError.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createPublicRouter } from './modules/public/public.routes.js';
import { createProjectsRouter } from './modules/projects/project.routes.js';
import { createWorkspacesRouter } from './modules/workspaces/workspaces.routes.js';
import { createCommentsRouter } from './modules/feedback/comment.routes.js';
import { createFeedbackRouter } from './modules/feedback/feedback.routes.js';
export interface PublicLimits {
  submit: { windowMs: number; limit: number };
  vote: { windowMs: number; limit: number };
  read: { windowMs: number; limit: number };
  /** Most feedback items one project accepts in 24 hours, from everyone combined. */
  dailySubmissionCapPerProject: number;
}

export interface AppConfig {
  /** The one website allowed to use cookie-authenticated routes, e.g. http://localhost:5173 */
  webOrigin: string;
  /** Mark cookies HTTPS-only. True in production. */
  secureCookies: boolean;
  /** Override the login/register rate limit (tests use this). */
  authRateLimit?: { windowMs: number; limit: number };
  /** Override the public widget API limits (tests use this). */
  publicLimits?: Partial<PublicLimits>;
}

/**
 * Things the app needs from the outside world. We PASS THEM IN instead of importing
 * them, so tests can supply fakes or a differently-configured copy.
 */
export interface AppDependencies {
  checkDatabase: () => Promise<void>;
  prisma: PrismaClient;
  config: AppConfig;
}

/**
 * Builds the Express app WITHOUT starting a server. Keeping "build" separate
 * from "listen" lets tests call the app directly (no real network port needed).
 */
export function createApp(deps: AppDependencies) {
  const { prisma, config } = deps;
  const app = express();

  // We will run behind a hosting proxy in production; needed for correct client IPs.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(pinoHttp({ logger }));
  app.use(helmet()); // sensible security headers

  // PUBLIC routes come BEFORE the cookie and JSON middleware below: they have their own
  // tiny body limit and must never touch cookies.
  app.use('/api/public', createPublicRouter({ prisma, config }));

  app.use(express.json({ limit: '100kb' })); // reject oversized bodies early
  app.use(cookieParser());

  // Liveness: "is the process running?" Never touches the database.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: "can it actually serve requests?" Includes the database.
  app.get('/api/health/ready', async (req, res) => {
    try {
      await deps.checkDatabase();
    } catch (err) {
      req.log.warn({ err }, 'Readiness check failed');
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable');
    }
    res.json({ status: 'ok', database: 'up' });
  });

  // Cookie-based routes: only our own web app may call these from a browser.
  const dashboardCors = cors({ origin: config.webOrigin, credentials: true });
  app.use('/api/auth', dashboardCors, createAuthRouter({ prisma, config }));
  app.use('/api/workspaces', dashboardCors, createWorkspacesRouter({ prisma, config }));
  app.use('/api/projects', dashboardCors, createProjectsRouter({ prisma, config }));
  app.use('/api/feedback', dashboardCors, createFeedbackRouter({ prisma, config }));
  app.use('/api/comments', dashboardCors, createCommentsRouter({ prisma, config }));
  app.use(notFoundHandler);
  app.use(errorHandler); // must be registered LAST

  return app;
}
