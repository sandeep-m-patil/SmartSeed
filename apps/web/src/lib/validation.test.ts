import { createBatchSchema, createTransferSchema, createUserSchema, recordSaleSchema, rejectTransferSchema } from '@smartseed/shared';
import { describe, expect, it } from 'vitest';
import { blankToUndefined, toOptionalNumber, validate } from './validation';

const UUID = '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b';
const validBatch = {
  productId: UUID, manufacturingDate: '2026-01-01', expiryDate: '2027-01-01', productionLocation: 'Hyderabad', facility: 'Plant 1',
  initialQuantity: 500, unit: 'packet',
};

describe('validate', () => {
  it('returns parsed data when valid', () => {
    const r = validate(createBatchSchema, validBatch);
    expect(r.ok).toBe(true);
  });

  it('maps issues to per-field messages', () => {
    const r = validate(createBatchSchema, { ...validBatch, expiryDate: '2025-01-01', productionLocation: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.expiryDate).toBe('Expiry must be after manufacturing date');
      expect(r.errors.productionLocation).toBeTruthy();
    }
  });

  it('replaces technical zod messages with a readable one for malformed numbers', () => {
    const r = validate(createBatchSchema, { ...validBatch, initialQuantity: Number.NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.initialQuantity).toBe('Enter a valid value');
  });

  it('rejects zero or fractional quantities for transfers and sales', () => {
    expect(validate(createTransferSchema, { batchId: UUID, toOrgId: UUID, quantity: 0 }).ok).toBe(false);
    expect(validate(recordSaleSchema, { batchId: UUID, quantity: 1.5 }).ok).toBe(false);
    expect(validate(recordSaleSchema, { batchId: UUID, quantity: 3 }).ok).toBe(true);
  });

  it('enforces password strength for new users', () => {
    const base = { email: 'a@b.co', fullName: 'Asha Rao', role: 'manufacturer' };
    const weak = validate(createUserSchema, { ...base, password: 'short' });
    expect(weak.ok).toBe(false);
    expect(validate(createUserSchema, { ...base, password: 'Str0ngPassw0rd!' }).ok).toBe(true);
  });

  it('requires a meaningful rejection reason', () => {
    expect(validate(rejectTransferSchema, { reason: 'x' }).ok).toBe(false);
    expect(validate(rejectTransferSchema, { reason: 'Damaged packaging' }).ok).toBe(true);
  });
});

describe('form value helpers', () => {
  it('toOptionalNumber', () => {
    expect(toOptionalNumber('  ')).toBeUndefined();
    expect(toOptionalNumber(' 42 ')).toBe(42);
    expect(Number.isNaN(toOptionalNumber('abc'))).toBe(true);
  });

  it('blankToUndefined', () => {
    expect(blankToUndefined('   ')).toBeUndefined();
    expect(blankToUndefined(' x ')).toBe('x');
  });
});
