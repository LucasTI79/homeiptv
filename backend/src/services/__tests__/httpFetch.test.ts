import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { EventEmitter } from 'events';
import { fetchUrlContent } from '../httpFetch';

function buildFakeResponse(statusCode: number, chunks: string[], headers: Record<string, string> = {}) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: () => void };
  res.statusCode = statusCode;
  res.headers = headers;
  res.destroy = () => {};
  process.nextTick(() => {
    for (const chunk of chunks) res.emit('data', Buffer.from(chunk));
    res.emit('end');
  });
  return res;
}

describe('fetchUrlContent', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(http, 'get');
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it('resolves with the concatenated response body as a string on HTTP 200', async () => {
    getSpy.mockImplementation((_url: unknown, _opts: unknown, callback?: unknown) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      (cb as (res: unknown) => void)(buildFakeResponse(200, ['hello ', 'world']));
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => {};
      return req as never;
    });

    const content = await fetchUrlContent('http://example.com/file.txt');

    expect(content).toBe('hello world');
  });

  it('rejects when the response status code is not 200', async () => {
    getSpy.mockImplementation((_url: unknown, _opts: unknown, callback?: unknown) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      (cb as (res: unknown) => void)(buildFakeResponse(404, []));
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => {};
      return req as never;
    });

    await expect(fetchUrlContent('http://example.com/missing.txt')).rejects.toThrow('Status Code 404');
  });
});
