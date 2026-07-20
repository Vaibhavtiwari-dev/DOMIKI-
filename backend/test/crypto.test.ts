import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/lib/crypto';

describe('canonical JSON', () => {
  it('produces stable object ordering and hashes', async () => {
    const left = canonicalJson({ z: 1, nested: { b: true, a: 'value' }, a: [2, 1] });
    const right = canonicalJson({ a: [2, 1], nested: { a: 'value', b: true }, z: 1 });

    expect(left).toBe(right);
    expect(await sha256Hex(left)).toBe(await sha256Hex(right));
  });
});
