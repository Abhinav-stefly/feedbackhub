/**
 * Escapes the three characters that have a special meaning inside a SQL LIKE pattern
 * (backslash, percent, underscore), so a visitor searching for "100%" or "snake_case"
 * searches for exactly that text instead of using them as wildcards.
 * (Prisma's `contains` does NOT do this for you.)
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
