import { beforeEach, describe, expect, it } from 'vitest';
import { putEventOnce } from '../src/ledger';
import { quantityCommitment } from '../src/pdc';
import { AUTH, DAY_MS, DIST, GATEWAY, Harness, MFR, RETAIL, T0, hash } from './helpers/harness';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.seedBatch();
});

describe('transfer preconditions', () => {
  it('rejects transfer of an expired batch (by date)', async () => {
    h.stub.setTime(T0 + 366 * DAY_MS);
    await expect(h.transfer()).rejects.toThrow(/BATCH_EXPIRED/);
  });

  it('rejects transfer of a revoked batch', async () => {
    await h.setStatus(AUTH, 'REVOKED');
    await expect(h.transfer()).rejects.toThrow(/BATCH_REVOKED/);
  });

  it('rejects transfer of a held batch', async () => {
    await h.setStatus(AUTH, 'HELD');
    await expect(h.transfer()).rejects.toThrow(/BATCH_HELD/);
  });

  it('rejects accept when the batch was revoked while in transit', async () => {
    const evId = await h.transfer();
    await h.setStatus(AUTH, 'REVOKED');
    await expect(h.respond(DIST, 'AcceptBatch', evId)).rejects.toThrow(/BATCH_REVOKED/);
  });

  it('still lets the receiver reject a revoked batch', async () => {
    const evId = await h.transfer();
    await h.setStatus(AUTH, 'REVOKED');
    expect((await h.respond(DIST, 'RejectBatch', evId)).status).toBe('COMMITTED');
  });

  it('rejects a transfer to self', async () => {
    await expect(h.transfer(MFR, MFR)).rejects.toThrow(/INVALID_INPUT/);
  });

  it('rejects a batch whose expiry is not after manufacture', async () => {
    await expect(h.registerBatch('batch-002', { expiryDateMs: T0 - 2 * DAY_MS })).rejects.toThrow(/INVALID_EXPIRY/);
  });

  it('rejects registering an existing batch or product id', async () => {
    await expect(h.registerBatch('batch-001')).rejects.toThrow(/ALREADY_EXISTS/);
    await expect(h.registerProduct('prod-001')).rejects.toThrow(/ALREADY_EXISTS/);
  });
});

describe('status transition matrix', () => {
  it.each([
    ['REVOKED', 'ACTIVE'],
    ['EXPIRED', 'HELD'],
    ['RECALLED', 'ACTIVE'],
    ['SOLD_OUT', 'HELD'],
  ])('rejects %s -> %s', async (from, to) => {
    await h.setStatus(AUTH, from === 'SOLD_OUT' ? 'SOLD_OUT' : from);
    await expect(h.setStatus(AUTH, to)).rejects.toThrow(/ILLEGAL_TRANSITION/);
  });

  it('rejects ACTIVE -> ACTIVE', async () => {
    await expect(h.setStatus(AUTH, 'ACTIVE')).rejects.toThrow(/ILLEGAL_TRANSITION/);
  });

  it('allows HELD -> ACTIVE (release) and RECALLED -> REVOKED', async () => {
    await h.setStatus(AUTH, 'HELD');
    await h.setStatus(AUTH, 'ACTIVE');
    await h.setStatus(AUTH, 'RECALLED');
    expect((await h.setStatus(AUTH, 'REVOKED')).status).toBe('COMMITTED');
  });
});

describe('idempotency and append-only events', () => {
  it('returns ALREADY_COMMITTED for a repeated eventId with the same payload and writes nothing', async () => {
    const input = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'IN' });
    const first = await h.call(GATEWAY, 'RecordFarmerVerification', input);
    const writesBefore = h.stub.writeLog.length;
    const second = await h.call(GATEWAY, 'RecordFarmerVerification', input);
    expect([first.status, second.status]).toEqual(['COMMITTED', 'ALREADY_COMMITTED']);
    expect(second.seq).toBe(first.seq);
    expect(h.stub.writeLog.length).toBe(writesBefore);
  });

  it('is idempotent even after the state moved on (replayed transfer after accept)', async () => {
    const input = h.base({ batchId: 'batch-001', toTenantId: 'tenant-dist', quantityCommitment: hash('qty-1000|salt') });
    await h.call(MFR, 'TransferBatch', input);
    await h.respond(DIST, 'AcceptBatch', input.eventId as string);
    expect((await h.call(MFR, 'TransferBatch', input)).status).toBe('ALREADY_COMMITTED');
  });

  it('errors when the same eventId carries a different payload', async () => {
    const input = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'IN' });
    await h.call(GATEWAY, 'RecordFarmerVerification', input);
    const tampered = { ...input, farmerHash: hash('other') };
    await expect(h.call(GATEWAY, 'RecordFarmerVerification', tampered)).rejects.toThrow(/DUPLICATE_EVENT_MISMATCH/);
  });

  it('refuses a raw PutState over an existing EVENT key', async () => {
    const ev = JSON.parse(h.stub.snapshot('EVENT:')[Object.keys(h.stub.snapshot('EVENT:'))[0]!]!);
    await expect(putEventOnce(h.ctx(MFR), ev)).rejects.toThrow(/EVENT_IMMUTABLE/);
  });

  it('never mutates existing events when later events are appended', async () => {
    const before = h.stub.snapshot('EVENT:');
    const evId = await h.transfer();
    await h.respond(DIST, 'AcceptBatch', evId);
    await h.setStatus(AUTH, 'HELD');
    const after = h.stub.snapshot('EVENT:');
    for (const [key, value] of Object.entries(before)) expect(after[key]).toBe(value);
    expect(Object.keys(after).length).toBeGreaterThan(Object.keys(before).length);
  });
});

describe('corrections', () => {
  it('records a correction as a new event pointing at the original, leaving it untouched', async () => {
    const original = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'IN' });
    await h.call(GATEWAY, 'RecordFarmerVerification', original);
    const before = h.stub.snapshot('EVENT:');
    const fix = h.base({ batchId: 'batch-001', farmerHash: hash('f2'), regionCode: 'IN-KA', corrects: original.eventId });
    await h.call(GATEWAY, 'RecordFarmerVerification', fix);
    const stored = await h.call(GATEWAY, 'GetEvent', fix.eventId as string);
    expect(stored.corrects).toBe(original.eventId);
    expect(h.stub.snapshot('EVENT:')[`EVENT:${original.eventId}`]).toBe(before[`EVENT:${original.eventId}`]);
  });

  it('rejects a correction of an unknown event', async () => {
    const fix = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'IN', corrects: 'evt-missing' });
    await expect(h.call(GATEWAY, 'RecordFarmerVerification', fix)).rejects.toThrow(/INVALID_CORRECTION/);
  });

  it('rejects a correction pointing at an event of another batch', async () => {
    await h.registerBatch('batch-002');
    const other = h.base({ batchId: 'batch-002', farmerHash: hash('f'), regionCode: 'IN' });
    await h.call(GATEWAY, 'RecordFarmerVerification', other);
    const fix = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'IN', corrects: other.eventId });
    await expect(h.call(GATEWAY, 'RecordFarmerVerification', fix)).rejects.toThrow(/INVALID_CORRECTION/);
  });
});

describe('history ordering', () => {
  it('returns events in strict sequence order, including beyond 9 events', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const input = h.base({ batchId: 'batch-001', farmerHash: hash(`f${i}`), regionCode: 'IN' });
      ids.push(input.eventId as string);
      await h.call(GATEWAY, 'RecordFarmerVerification', input);
    }
    const history = await h.call(AUTH, 'GetBatchHistory', 'batch-001');
    expect(history.map((e: { seq: number }) => e.seq)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(history.slice(1).map((e: { eventId: string }) => e.eventId)).toEqual(ids);
  });

  it('uses the BATCH~EVENT composite key namespace', async () => {
    const keys = [...h.stub.state.keys()].filter((k) => k.includes('BATCH~EVENT'));
    expect(keys[0]).toBe('\u0000BATCH~EVENT\u0000batch-001\u00000000000001\u0000');
  });
});

describe('private data and on-chain content', () => {
  const commitment = quantityCommitment('1000', 'pepper');

  async function transferWithQuantity(quantity: string, salt: string): Promise<any> {
    h.stub.setTransient({ quantity, salt });
    const input = h.base({ batchId: 'batch-001', toTenantId: 'tenant-dist', quantityCommitment: commitment });
    return h.call(MFR, 'TransferBatch', input);
  }

  it('stores a quantity opened by transient data in pdc_<tenantId> only', async () => {
    await transferWithQuantity('1000', 'pepper');
    const keys = [...h.stub.privateData.keys()];
    expect(keys.every((k) => k.startsWith('pdc_tenant-mfr/'))).toBe(true);
    expect(keys).toHaveLength(1);
    expect([...h.stub.state.values()].some((v) => v.toString().includes('pepper'))).toBe(false);
  });

  it('writes no private data when no transient quantity is supplied', async () => {
    await h.transfer();
    expect(h.stub.privateData.size).toBe(0);
  });

  it('rejects a transient quantity that does not open the commitment', async () => {
    await expect(transferWithQuantity('999', 'pepper')).rejects.toThrow(/COMMITMENT_MISMATCH/);
  });

  it('rejects an aggregate retail sale above the received quantity', async () => {
    const evId = (await transferWithQuantity('1000', 'pepper')).eventId as string;
    h.stub.setTransient({ quantity: '1000', salt: 'pepper' });
    await h.respond(DIST, 'AcceptBatch', evId);
    h.stub.setTransient({});
    const onward = h.base({ batchId: 'batch-001', toTenantId: 'tenant-retail', quantityCommitment: commitment });
    await h.call(DIST, 'TransferBatch', onward);
    h.stub.setTransient({ quantity: '1000', salt: 'pepper' });
    await h.respond(RETAIL, 'AcceptBatch', onward.eventId as string);
    const sell = async (qty: string) => {
      h.stub.setTransient({ quantity: qty, salt: 's' });
      return h.call(RETAIL, 'RecordRetailSale', h.base({ batchId: 'batch-001', saleCommitment: quantityCommitment(qty, 's') }));
    };
    await sell('600');
    await expect(sell('600')).rejects.toThrow(/QUANTITY_EXCEEDED/);
  });
});

describe('input validation (no PII / free text)', () => {
  it('rejects unknown fields such as a farmer name', async () => {
    const input = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'IN', farmerName: 'A Person' });
    await expect(h.call(GATEWAY, 'RecordFarmerVerification', input)).rejects.toThrow(/INVALID_INPUT/);
  });

  it('rejects free-text region codes and malformed hashes', async () => {
    const text = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'Village near river' });
    await expect(h.call(GATEWAY, 'RecordFarmerVerification', text)).rejects.toThrow(/INVALID_INPUT/);
    const badHash = h.base({ batchId: 'batch-001', farmerHash: 'ZZ', regionCode: 'IN' });
    await expect(h.call(GATEWAY, 'RecordFarmerVerification', badHash)).rejects.toThrow(/INVALID_INPUT/);
  });

  it('rejects non-JSON input', async () => {
    await expect(h.call(GATEWAY, 'RecordCounterfeitReport', '{oops')).rejects.toThrow(/INVALID_INPUT/);
  });

  it('stores events containing only allow-listed fields', async () => {
    const allowed = new Set([
      'eventId', 'eventType', 'batchId', 'seq', 'ts', 'payloadHash', 'recordHash', 'actorOrgHash',
      'fromOrgHash', 'toOrgHash', 'quantityCommitment', 'dbRecordRef', 'signatureRef', 'corrects', 'attrs',
    ]);
    await h.transfer();
    for (const raw of Object.values(h.stub.snapshot('EVENT:'))) {
      expect(Object.keys(JSON.parse(raw)).filter((k) => !allowed.has(k))).toEqual([]);
    }
  });
});
