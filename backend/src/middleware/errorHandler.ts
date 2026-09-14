import type { Request, Response, NextFunction } from 'express';
import { isAppError } from '../errors';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorResponseBody = { error: { code: 'NOT_FOUND', message: 'Route not found.' } };
  res.status(404).json(body);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4 params to recognize this as error middleware
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (isAppError(err)) {
    const body: ErrorResponseBody = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) {
      body.error.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  console.error('[ERROR_HANDLER] Unhandled error:', err instanceof Error ? err.stack || err.message : err);
  const body: ErrorResponseBody = { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
  res.status(500).json(body);
}
