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

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    console.error(
      `[ERROR_HANDLER] Error after response started on ${req.method} ${req.originalUrl}:`,
      err instanceof Error ? err.stack || err.message : err
    );
    next(err);
    return;
  }

  if (isAppError(err)) {
    const body: ErrorResponseBody = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) {
      body.error.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  console.error(
    `[ERROR_HANDLER] Unhandled error on ${req.method} ${req.originalUrl}:`,
    err instanceof Error ? err.stack || err.message : err
  );
  const body: ErrorResponseBody = { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
  res.status(500).json(body);
}
