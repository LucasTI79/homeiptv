import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, ApiError } from './client';

describe('apiFetch error message extraction', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('extracts the message from the old string error shape', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Authentication required.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(apiFetch('/api/whatever')).rejects.toMatchObject({
      message: 'Authentication required.',
      status: 401,
    });

    try {
      await apiFetch('/api/whatever');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
    }
  });

  it('extracts the message from the new structured error shape', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'VALIDATION_ERROR', message: 'streamUrl is required' },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    await expect(apiFetch('/api/cast/generate-token')).rejects.toMatchObject({
      message: 'streamUrl is required',
      status: 400,
    });
  });
});
