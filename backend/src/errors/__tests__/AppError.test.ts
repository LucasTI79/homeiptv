import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, ValidationError, UpstreamError, isAppError } from '../index';

describe('AppError', () => {
  it('sets message, statusCode, code, and details', () => {
    const err = new AppError('Something broke', 500, 'INTERNAL_ERROR', { foo: 'bar' });
    expect(err.message).toBe('Something broke');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the error name for stack traces', () => {
    const err = new AppError('x', 500, 'INTERNAL_ERROR');
    expect(err.name).toBe('AppError');
  });
});

describe('NotFoundError', () => {
  it('defaults to 404 / NOT_FOUND', () => {
    const err = new NotFoundError('Channel not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Channel not found');
    expect(err.name).toBe('NotFoundError');
  });
});

describe('ValidationError', () => {
  it('defaults to 400 / VALIDATION_ERROR and carries details', () => {
    const err = new ValidationError('Missing url parameter', { field: 'url' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ field: 'url' });
  });
});

describe('UpstreamError', () => {
  it('defaults to 502 / UPSTREAM_ERROR', () => {
    const err = new UpstreamError('XC server timed out');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('UPSTREAM_ERROR');
  });
});

describe('isAppError', () => {
  it('returns true for AppError and subclasses', () => {
    expect(isAppError(new AppError('x', 500, 'INTERNAL_ERROR'))).toBe(true);
    expect(isAppError(new NotFoundError('x'))).toBe(true);
  });

  it('returns false for plain Error and non-errors', () => {
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('x')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
