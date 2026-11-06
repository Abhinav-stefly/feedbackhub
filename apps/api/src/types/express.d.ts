import type { PublicUser } from '../modules/auth/auth.service.js';

// Teaches TypeScript that `req.user` exists (set by requireAuth).
declare module 'express-serve-static-core' {
  interface Request {
    user?: PublicUser;
  }
}
