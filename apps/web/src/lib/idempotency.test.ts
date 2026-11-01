import { idempotencyKeySchema } from '@smartseed/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { idempotencyHeader, isValidIdempotencyKey, newIdempotencyKey } from './idempotency';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('newIdempotencyKey', () => {
  it('produces a v4 UUID accepted by the API schema', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(UUID_V4);
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it('is unique per call', () => {
    const keys = new Set(Array.from({ length: 200 }, newIdempotencyKey));
    expect(keys.size).toBe(200);
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    const real = crypto;
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView<ArrayBuffer>>(a: T) => real.getRandomValues(a) });
    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });

  it('builds the request header', () => {
    expect(idempotencyHeader('abc-12345')).toEqual({ 'Idempotency-Key': 'abc-12345' });
  });

  it('rejects keys outside the 8-100 character range', () => {
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(101))).toBe(false);
  });
});
