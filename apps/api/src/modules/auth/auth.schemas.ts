import { z } from 'zod';

// Emails are trimmed and lower-cased BEFORE validation, so "ADA@Example.com "
// and "ada@example.com" are the same account.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const registerSchema = z.object({
  email: emailSchema,
  // Length matters more than fancy rules. The 128 cap stops someone from
  // sending a gigantic "password" to make the server waste time hashing it.
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(80),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.output<typeof registerSchema>;
export type LoginInput = z.output<typeof loginSchema>;
