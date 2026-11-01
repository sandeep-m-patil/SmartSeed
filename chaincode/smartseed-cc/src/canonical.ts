import { createHash } from 'node:crypto';

/**
 * RFC 8785 (JCS) style canonical JSON.
 * - object keys sorted by UTF-16 code units
 * - strings and numbers serialised per ECMAScript (JSON.stringify), which is what RFC 8785 mandates
 * - no insignificant whitespace; undefined object members are omitted
 * Non-finite numbers, bigint, functions and symbols are rejected.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return canonicalNumber(value);
    case 'object':
      return Array.isArray(value) ? canonicalArray(value) : canonicalObject(value as Record<string, unknown>);
    default:
      throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
  }
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('Cannot canonicalize non-finite number');
  return JSON.stringify(value);
}

function canonicalArray(values: unknown[]): string {
  return `[${values.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`;
}

function canonicalObject(obj: Record<string, unknown>): string {
  const members = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`);
  return `{${members.join(',')}}`;
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** SHA-256 (lowercase hex) of the canonical JSON form of `value`. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
