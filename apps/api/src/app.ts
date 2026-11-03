import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

/**
 * Builds the Express app WITHOUT starting a server. Keeping "build" separate
 * from "listen" lets tests call the app directly (no real network port needed).
 */
export function createApp() {
  const app = express();

  // We will run behind a hosting proxy in production; needed later for correct client IPs.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(pinoHttp({ logger }));
  app.use(helmet()); // sensible security headers
  app.use(express.json({ limit: '100kb' })); // reject oversized bodies early

  app.get('/api/health', (_req, res) => {
    // Liveness only. A database check is added in Milestone 2.
    res.json({ status: 'ok' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler); // must be registered LAST

  return app;
}