export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers };

  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.error === 'string') {
        message = body.error;
      } else if (typeof body?.error?.message === 'string') {
        message = body.error.message;
      }
    } catch {
      // response wasn't JSON, keep statusText
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
