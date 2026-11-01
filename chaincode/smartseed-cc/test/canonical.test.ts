import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalize } from '../src/canonical';
import { quantityCommitment } from '../src/pdc';

interface Vectors {
  cases: { name: string; inputJson: string; canonical: string; expectedHash: string }[];
  quantityCommitments: { quantity: string; salt: string; expectedCommitment: string }[];
}

const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', 'test-vectors', 'canonical-hash.json'), 'utf8'),
) as Vectors;

describe('canonical JSON + SHA-256 (shared test vectors)', () => {
  it.each(vectors.cases)('canonicalizes vector "$name" to the hand-written RFC 8785 form', (c) => {
    expect(canonicalize(JSON.parse(c.inputJson))).toBe(c.canonical);
  });

  it.each(vectors.cases)('hashes vector "$name" to the expected digest', (c) => {
    expect(canonicalHash(JSON.parse(c.inputJson))).toBe(c.expectedHash);
  });

  it.each(vectors.quantityCommitments)('computes quantity commitment for $quantity', (c) => {
    expect(quantityCommitment(c.quantity, c.salt)).toBe(c.expectedCommitment);
  });
});

describe('canonicalize behaviour', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalHash({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('omits undefined object members and nulls undefined array items', () => {
    expect(canonicalize({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow(TypeError);
  });

  it('rejects unsupported types', () => {
    expect(() => canonicalize({ n: BigInt(1) })).toThrow(TypeError);
  });

  it('produces known SHA-256 for {"a":1,"b":2}', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
  });
});
