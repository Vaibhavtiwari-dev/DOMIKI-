export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '/api');

interface ErrorPayload {
  error?: { message?: string; code?: string };
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(
    message: string,
    status: number,
    code?: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload & { data?: T };
  if (!response.ok) {
    throw new ApiClientError(
      payload.error?.message ?? 'The server could not complete this request.',
      response.status,
      payload.error?.code,
    );
  }
  return payload.data as T;
}

export function initializeResearchSession(): Promise<{ expiresAt: string }> {
  return apiRequest('/v1/demo/session', { method: 'POST' });
}

export function readResearchSession(): Promise<{ active: boolean }> {
  return apiRequest('/v1/demo/session');
}

export function endResearchSession(): Promise<void> {
  return apiRequest('/v1/demo/session', { method: 'DELETE' });
}
