import type { z } from 'zod';
import { ApiError } from './errors.js';

const DEFAULT_MAX_BYTES = 2_000_000;

export async function parseProviderJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  maximumBytes = DEFAULT_MAX_BYTES,
): Promise<T> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ApiError(
      502,
      'MARKET_DATA_RESPONSE_TOO_LARGE',
      'The market-data response was too large.',
    );
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new ApiError(
      502,
      'MARKET_DATA_RESPONSE_TOO_LARGE',
      'The market-data response was too large.',
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError(
      502,
      'MARKET_DATA_RESPONSE_INVALID',
      'The market-data provider returned invalid JSON.',
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      502,
      'MARKET_DATA_SCHEMA_CHANGED',
      'The market-data response format is unsupported.',
    );
  }
  return parsed.data;
}
