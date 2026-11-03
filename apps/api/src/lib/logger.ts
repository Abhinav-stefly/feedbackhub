import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Structured (JSON) logging with redaction. If a request ever carries a cookie
 * or password, it is replaced with "[Redacted]" before being written anywhere.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
    ],
    censor: '[Redacted]',
  },
});