import { beforeEach, describe, expect, it } from 'vitest';
import { orgHash } from '../src/auth';
import { ADMIN, AUTH, CARRIER, DIST, GATEWAY, Harness, MFR, RETAIL, hash } from './helpers/harness';

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe('registration', () => {
  it('RegisterProduct commits without a batch sequence', async () => {
    const res = await h.registerProduct();
    expect(res).toMatchObject({ status: 'COMMITTED' });
    expect(res.seq).toBeUndefined();
  });

  it('RegisterBatch creates an ACTIVE batch owned by the caller with seq 1', async () => {
    await h.registerProduct();
    const res = await h.registerBatch();
    const batch = await h.call(MFR, 'GetBatch', 'batch-001');
    expect(res.seq).toBe(1);
    expect(batch).toMatchObject({ status: 'ACTIVE', originTenantId: 'tenant-mfr' });
    expect(batch.holders).toHaveLength(1);
    expect(batch.pendingTransfer).toBeUndefined();
  });
});

describe('transfer lifecycle', () => {
  beforeEach(async () => {
    await h.seedBatch();
  });

  it('TransferBatch records a pending transfer with hashed party ids', async () => {
    const evId = await h.transfer();
    const event = await h.call(MFR, 'GetEvent', evId);
    const pending = JSON.parse(h.stub.state.get(`PENDING:batch-001:${evId}`)!.toString());
    expect(pending).toMatchObject({ fromTenantId: 'tenant-mfr', toTenantId: 'tenant-dist' });
    expect(event.toOrgHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain('tenant-dist');
  });

  it('AcceptBatch adds the receiver as holder, keeps the sender, and clears the pending', async () => {
    const evId = await h.transfer();
    await h.respond(DIST, 'AcceptBatch', evId);
    const batch = await h.call(DIST, 'GetBatch', 'batch-001');
    expect(batch.holders.map((x: { holderHash: string }) => x.holderHash).sort()).toEqual(
      [orgHash('tenant-mfr'), orgHash('tenant-dist')].sort(),
    );
    expect(h.stub.state.has(`PENDING:batch-001:${evId}`)).toBe(false);
    expect(JSON.stringify(batch)).not.toContain('tenant-dist');
  });

  it('RejectBatch adds no holder and clears the pending transfer', async () => {
    const evId = await h.transfer();
    await h.respond(DIST, 'RejectBatch', evId);
    const batch = await h.call(MFR, 'GetBatch', 'batch-001');
    expect(batch.holders).toHaveLength(1);
    expect(h.stub.state.has(`PENDING:batch-001:${evId}`)).toBe(false);
  });

  it('CancelTransfer by the sender clears the pending and emits TRANSFER_CANCELLED', async () => {
    const evId = await h.transfer();
    const res = await h.respond(MFR, 'CancelTransfer', evId);
    const event = await h.call(MFR, 'GetEvent', res.eventId);
    expect(event.eventType).toBe('TRANSFER_CANCELLED');
    expect(h.stub.state.has(`PENDING:batch-001:${evId}`)).toBe(false);
  });

  it('RecordShipment by a carrier links to the pending transfer', async () => {
    const evId = await h.transfer();
    const res = await h.call(CARRIER, 'RecordShipment', h.base({ batchId: 'batch-001', transferEventId: evId }));
    expect(res.status).toBe('COMMITTED');
  });

  it('RecordShipment by the sending owner is allowed', async () => {
    const evId = await h.transfer();
    const res = await h.call(MFR, 'RecordShipment', h.base({ batchId: 'batch-001', transferEventId: evId }));
    expect(res.status).toBe('COMMITTED');
  });

  it('RecordRetailSale by the retailer owner commits a sale event', async () => {
    await h.respond(DIST, 'AcceptBatch', await h.transfer());
    await h.respond(RETAIL, 'AcceptBatch', await h.transfer(RETAIL, DIST));
    const sale = h.base({ batchId: 'batch-001', saleCommitment: hash('sale-1') });
    expect((await h.call(RETAIL, 'RecordRetailSale', sale)).status).toBe('COMMITTED');
  });
});

describe('compliance events', () => {
  beforeEach(async () => {
    await h.seedBatch();
  });

  it('RecordFarmerVerification stores only a hash and coarse region', async () => {
    const input = h.base({ batchId: 'batch-001', farmerHash: hash('farmer'), regionCode: 'IN-KA' });
    const res = await h.call(GATEWAY, 'RecordFarmerVerification', input);
    const event = await h.call(GATEWAY, 'GetEvent', res.eventId);
    expect(event.attrs).toEqual({ farmerHash: hash('farmer'), regionCode: 'IN-KA' });
  });

  it('UpdateBatchStatus lets the authority hold a batch', async () => {
    await h.setStatus(AUTH, 'HELD');
    expect((await h.call(AUTH, 'GetBatch', 'batch-001')).status).toBe('HELD');
  });

  it('UpdateBatchStatus lets the owner mark stock SOLD_OUT', async () => {
    await h.setStatus(MFR, 'SOLD_OUT');
    expect((await h.call(MFR, 'GetBatch', 'batch-001')).status).toBe('SOLD_OUT');
  });

  it('counterfeit report then CONFIRMED outcome revokes the batch', async () => {
    const report = h.base({ batchId: 'batch-001', reason: 'LABEL_MISMATCH' });
    await h.call(GATEWAY, 'RecordCounterfeitReport', report);
    const outcome = h.base({ batchId: 'batch-001', reportEventId: report.eventId, outcome: 'CONFIRMED' });
    await h.call(ADMIN, 'RecordInvestigationOutcome', outcome);
    expect((await h.call(AUTH, 'GetBatch', 'batch-001')).status).toBe('REVOKED');
  });

  it('CLEARED outcome releases a held batch', async () => {
    const report = h.base({ batchId: 'batch-001', reason: 'DUPLICATE_SCAN' });
    await h.call(GATEWAY, 'RecordCounterfeitReport', report);
    await h.setStatus(AUTH, 'HELD');
    const outcome = h.base({ batchId: 'batch-001', reportEventId: report.eventId, outcome: 'CLEARED' });
    await h.call(AUTH, 'RecordInvestigationOutcome', outcome);
    expect((await h.call(AUTH, 'GetBatch', 'batch-001')).status).toBe('ACTIVE');
  });

  it('outcome must reference a counterfeit report on the same batch', async () => {
    const notReport = await h.setStatus(AUTH, 'HELD');
    const outcome = h.base({ batchId: 'batch-001', reportEventId: notReport.eventId, outcome: 'CONFIRMED' });
    await expect(h.call(AUTH, 'RecordInvestigationOutcome', outcome)).rejects.toThrow(/INVALID_INPUT/);
  });
});

describe('read functions', () => {
  it('GetEvent and VerifyRecordHash compare against the committed recordHash', async () => {
    await h.registerProduct();
    const input = h.base({ batchId: 'batch-001', productId: 'prod-001', quantityCommitment: hash('q'), mfgDateMs: 1, expiryDateMs: 2 });
    await h.call(MFR, 'RegisterBatch', input);
    const ok = await h.call(AUTH, 'VerifyRecordHash', input.eventId as string, input.recordHash as string);
    const bad = await h.call(AUTH, 'VerifyRecordHash', input.eventId as string, hash('tampered'));
    expect([ok.matches, bad.matches]).toEqual([true, false]);
  });

  it('GetBatch fails for an unknown batch', async () => {
    await expect(h.call(MFR, 'GetBatch', 'nope-123')).rejects.toThrow(/NOT_FOUND/);
  });
});
