import { ApiError } from './errors';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export async function firstOrThrow<T>(
  statement: D1PreparedStatement,
  resource = 'Resource',
): Promise<T> {
  const row = await statement.first<T>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', `${resource} was not found.`);
  return row;
}

export function changes(result: D1Result): number {
  return result.meta.changes;
}

export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function encodeCursor(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeCursor(cursor: string): string {
  try {
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid.');
  }
}
