import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError, notFound } from '../lib/httpError.js';

/** Every error response in the API has this exact shape: { error: { code, message } } */
function body(code: string, message: string) {
  return { error: { code, message } };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(body(err.code, err.message));
    return;
  }

  // Errors raised by Express's own parsers (too-large body, malformed JSON)
  // carry a 4xx status. Map them to our shape without leaking internals.
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    const message = status === 413 ? 'Request body is too large' : 'Malformed request';
    res.status(status).json(body(code, message));
    return;
  }

  // Unknown failure = a bug. Log the details for us, tell the client nothing.
  req.log.error({ err }, 'Unhandled error');
  res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong'));
};
