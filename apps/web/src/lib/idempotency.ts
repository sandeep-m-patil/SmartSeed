import { MAX_IDEMPOTENCY_KEY_LENGTH, MIN_IDEMPOTENCY_KEY_LENGTH } from './constants';

const RANDOM_BYTES = 16;
const HEX_RADIX = 16;
const UUID_VERSION_4 = 0x40;
const UUID_VARIANT = 0x80;

/** RFC 4122 v4 UUID. Uses crypto.randomUUID when present, else getRandomValues (older WebViews / insecure origins). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_BYTES));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | UUID_VERSION_4;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | UUID_VARIANT;
  const hex = Array.from(bytes, (b) => b.toString(HEX_RADIX).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= MIN_IDEMPOTENCY_KEY_LENGTH && key.length <= MAX_IDEMPOTENCY_KEY_LENGTH;
}

export const idempotencyHeader = (key: string): Record<string, string> => ({ 'Idempotency-Key': key });
