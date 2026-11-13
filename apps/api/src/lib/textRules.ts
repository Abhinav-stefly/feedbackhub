/** Postgres cannot store the NUL character; rejecting it up front avoids a server error. */
export const noNulChars = (value: string) => !value.includes('\u0000');
