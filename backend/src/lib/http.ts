import type { Context } from 'hono';
import type { AppEnvironment } from '../types.js';

export function ok<T>(
  context: Context<AppEnvironment>,
  data: T,
  status: 200 | 201 = 200,
): Response {
  return context.json({ data, traceId: context.get('requestId') }, status);
}

export function noContent(context: Context<AppEnvironment>): Response {
  return context.body(null, 204);
}

export async function readJson(
  context: Context<AppEnvironment>,
  maxBytes = 1_000_000,
): Promise<unknown> {
  const contentType = context.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content type must be application/json.');
    error.name = 'UnsupportedMediaType';
    throw error;
  }
  const length = Number(context.req.header('content-length') ?? '0');
  if (Number.isFinite(length) && length > maxBytes) {
    const error = new Error('Request body is too large.');
    error.name = 'PayloadTooLarge';
    throw error;
  }
  const text = await context.req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    const error = new Error('Request body is too large.');
    error.name = 'PayloadTooLarge';
    throw error;
  }
  return JSON.parse(text) as unknown;
}

export function clientIp(context: Context<AppEnvironment>): string | undefined {
  return context.req.header('cf-connecting-ip') ?? context.req.header('x-real-ip');
}
