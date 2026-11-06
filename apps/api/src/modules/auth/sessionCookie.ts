import type { Request } from 'express';
import { SESSION_TTL_MS } from './session.service.js';

export const SESSION_COOKIE = 'fh_session';

/** Reads the session token from the request cookie, if there is one. */
export function readSessionToken(req: Request): string | undefined {
  const value: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Cookie settings that must be IDENTICAL when setting and clearing the cookie,
 * otherwise the browser treats them as two different cookies and will not delete it.
 */
export function sessionCookieBase(secure: boolean) {
  return {
    httpOnly: true, // JavaScript in the page cannot read it, so XSS cannot steal it
    secure, // HTTPS only (switched on in production)
    sameSite: 'lax' as const, // not sent on cross-site POSTs: first line of CSRF defence
    path: '/',
  };
}

/** Settings used when logging in: the base plus a lifetime. */
export function sessionCookieOptions(secure: boolean) {
  return { ...sessionCookieBase(secure), maxAge: SESSION_TTL_MS };
}
