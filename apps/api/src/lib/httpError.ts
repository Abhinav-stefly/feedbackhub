/**
 * An error we THROW ON PURPOSE with a status code that is safe to show clients.
 * Anything that is not an HttpError is treated as an unexpected bug (500) and
 * its details are hidden from the client.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message = 'Resource not found') =>
  new HttpError(404, 'NOT_FOUND', message);