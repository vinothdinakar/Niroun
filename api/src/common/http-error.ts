import { HttpException } from '@nestjs/common';

// Every business error in Bond is an HttpError with a stable machine-readable `code`.
// The wire format is { error: { code, message, details? } } (see AllExceptionsFilter),
// which is what the SDK and the dashboard branch on.
export class HttpError extends HttpException {
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.details = details;
    this.message = message;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new HttpError(400, code, message, details);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (code: string, message: string) => new HttpError(404, code, message);
