import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (resource = 'Resource'): ApiError =>
  new ApiError(404, 'NOT_FOUND', `${resource} was not found.`);

export const forbidden = (): ApiError =>
  new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof z.ZodError) {
    return new ApiError(400, 'VALIDATION_FAILED', 'The request is invalid.', false, {
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  if (error instanceof SyntaxError) {
    return new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.', true);
}

export function isD1Constraint(error: unknown, fragment: string): boolean {
  return error instanceof Error && error.message.includes(fragment);
}
