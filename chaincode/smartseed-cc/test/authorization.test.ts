import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH, DIST, GATEWAY, Harness, MFR, RETAIL, hash } from './helpers/harness';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.seedBatch();
});

describe('role authorisation', () => {
  it('rejects a distributor registering a product', async () => {
    await expect(h.registerProduct('prod-002', DIST)).rejects.toThrow(/UNAUTHORIZED_ROLE/);
  });

  it('rejects a gateway transferring a batch', async () => {
    const input = h.base({ batchId: 'batch-001', toTenantId: 'tenant-dist', quantityCommitment: hash('q') });
    await expect(h.call(GATEWAY, 'TransferBatch', input)).rejects.toThrow(/UNAUTHORIZED_ROLE/);
  });

  it('rejects a manufacturer recording an investigation outcome', async () => {
    const input = h.base({ batchId: 'batch-001', reportEventId: 'evt-x-1', outcome: 'CONFIRMED' });
    await expect(h.call(MFR, 'RecordInvestigationOutcome', input)).rejects.toThrow(/UNAUTHORIZED_ROLE/);
  });

  it('rejects a retailer submitting farmer verifications', async () => {
    const input = h.base({ batchId: 'batch-001', farmerHash: hash('f'), regionCode: 'IN' });
    await expect(h.call(RETAIL, 'RecordFarmerVerification', input)).rejects.toThrow(/UNAUTHORIZED_ROLE/);
  });

  it('rejects an owner trying to place a HELD status (privileged only)', async () => {
    await expect(h.setStatus(MFR, 'HELD')).rejects.toThrow(/UNAUTHORIZED_ROLE/);
  });

  it('rejects an identity with an unknown role', async () => {
    const stranger = { role: 'wizard', tenantId: 't-1234', orgId: 'o-1234' };
    await expect(h.call(stranger, 'GetBatch', 'batch-001')).rejects.toThrow(/UNAUTHORIZED_ROLE/);
  });

  it('rejects an identity missing the tenantId attribute', async () => {
    const noTenant = { role: 'manufacturer', orgId: 'o-1234' };
    await expect(h.registerProduct('prod-009', noTenant)).rejects.toThrow(/MISSING_ATTRIBUTE/);
  });
});

describe('tenant isolation', () => {
  it('rejects RegisterProduct for another tenant as owner', async () => {
    const input = h.base({ productId: 'prod-002', ownerTenantId: 'tenant-other' });
    await expect(h.call(MFR, 'RegisterProduct', input)).rejects.toThrow(/WRONG_TENANT/);
  });

  it('rejects another manufacturer registering a batch on a product it does not own', async () => {
    const rival = { role: 'manufacturer', tenantId: 'tenant-rival', orgId: 'org-rival' };
    const input = h.base({
      batchId: 'batch-777',
      productId: 'prod-001',
      quantityCommitment: hash('q'),
      mfgDateMs: 1,
      expiryDateMs: 2,
    });
    await expect(h.call(rival, 'RegisterBatch', input)).rejects.toThrow(/NOT_OWNER/);
  });
});

describe('holder, receiver and sender rules', () => {
  it('rejects a transfer by a non-holder', async () => {
    await expect(h.transfer(RETAIL, DIST)).rejects.toThrow(/NOT_HOLDER/);
  });

  it('rejects accept by an org that is not the designated receiver', async () => {
    const evId = await h.transfer(DIST, MFR);
    await expect(h.respond(RETAIL, 'AcceptBatch', evId)).rejects.toThrow(/NOT_RECEIVER/);
  });

  it('rejects reject by an org that is not the designated receiver', async () => {
    const evId = await h.transfer(DIST, MFR);
    await expect(h.respond(MFR, 'RejectBatch', evId)).rejects.toThrow(/NOT_RECEIVER/);
  });

  it('makes accept one-shot: a second accept finds no pending transfer', async () => {
    const evId = await h.transfer();
    await h.respond(DIST, 'AcceptBatch', evId);
    await expect(h.respond(DIST, 'AcceptBatch', evId)).rejects.toThrow(/NO_PENDING_TRANSFER/);
  });

  it('makes reject one-shot: accept after reject fails', async () => {
    const evId = await h.transfer();
    await h.respond(DIST, 'RejectBatch', evId);
    await expect(h.respond(DIST, 'AcceptBatch', evId)).rejects.toThrow(/NO_PENDING_TRANSFER/);
  });

  it('rejects a retail sale by a retailer that does not hold the batch', async () => {
    const sale = h.base({ batchId: 'batch-001', saleCommitment: hash('s') });
    await expect(h.call(RETAIL, 'RecordRetailSale', sale)).rejects.toThrow(/NOT_HOLDER/);
  });

  it('rejects a shipment that is not linked to the pending transfer', async () => {
    const input = h.base({ batchId: 'batch-001', transferEventId: 'evt-none-1' });
    await expect(h.call(MFR, 'RecordShipment', input)).rejects.toThrow(/NO_PENDING_TRANSFER/);
  });

  it('rejects a non-holder marking stock SOLD_OUT', async () => {
    await expect(h.setStatus(DIST, 'SOLD_OUT')).rejects.toThrow(/NOT_HOLDER/);
  });

  it('lets the authority act on batches of any tenant', async () => {
    expect((await h.setStatus(AUTH, 'RECALLED')).status).toBe('COMMITTED');
  });
});
