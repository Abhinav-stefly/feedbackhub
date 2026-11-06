import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { checkDatabase, prisma } from './lib/prisma.js';

const app = createApp({
  checkDatabase,
  prisma,
  config: { webOrigin: env.WEB_ORIGIN, secureCookies: env.NODE_ENV === 'production' },
});

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Hosting platforms stop apps with SIGTERM. Finish in-flight requests,
// close the database connections politely, then exit.
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
