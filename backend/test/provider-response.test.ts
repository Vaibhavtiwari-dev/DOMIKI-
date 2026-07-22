import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseProviderJson } from '../src/lib/provider-response';

describe('bounded provider responses', () => {
  it('accepts a valid bounded payload', async () => {
    await expect(
      parseProviderJson(new Response('{"ok":true}'), z.object({ ok: z.literal(true) })),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects an oversized payload before parsing', async () => {
    await expect(parseProviderJson(new Response('123456'), z.string(), 5)).rejects.toMatchObject({
      code: 'MARKET_DATA_RESPONSE_TOO_LARGE',
    });
  });

  it('does not expose provider schema details', async () => {
    await expect(
      parseProviderJson(new Response('{"changed":true}'), z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ code: 'MARKET_DATA_SCHEMA_CHANGED' });
  });
});
