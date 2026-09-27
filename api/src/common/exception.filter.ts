import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { HttpError } from './http-error';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
  413: 'BODY_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'TOO_MANY_REQUESTS',
};

// One error format for the whole API: { error: { code, message, details? } }.
// Business errors carry their own code (HttpError); framework errors (unknown route, ...) are mapped to a generic one;
// anything unexpected is logged and reported as INTERNAL without leaking details.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpError) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({ error: { code: CODES[status] ?? 'ERROR', message: status === 404 ? 'Not found' : exception.message } });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal error' } });
  }
}
