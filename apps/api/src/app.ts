import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { HttpError } from './lib/httpError.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

/**
 * Things the app needs from the outside world. We PASS THEM IN instead of importing
 * them, so tests can supply fakes (a "database" that is up, or one that is down).
 */
export interface AppDependencies {
  checkDatabase: () => Promise<void>;
}

/**
 * Builds the Express app WITHOUT starting a server. Keeping "build" separate
 * from "listen" lets tests call the app directly (no real network port needed).
 */
export function createApp(deps: AppDependencies) {
  const app = express();

  // We will run behind a hosting proxy in production; needed later for correct client IPs.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(pinoHttp({ logger }));
  app.use(helmet()); // sensible security headers
  app.use(express.json({ limit: '100kb' })); // reject oversized bodies early

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

  app.use(notFoundHandler);
  app.use(errorHandler); // must be registered LAST

  return app;
}
