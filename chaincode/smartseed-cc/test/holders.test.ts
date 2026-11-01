import { beforeEach, describe, expect, it } from 'vitest';
import { orgHash } from '../src/auth';
import { quantityCommitment } from '../src/pdc';
import type { IdentitySpec } from './helpers/mock-stub';
import { AUTH, DIST, Harness, MFR, RETAIL, hash } from './helpers/harness';

const D2 = { role: 'distributor', tenantId: 'tenant-dist2', orgId: 'org-dist2' };
const C5000 = quantityCommitment('5000', 's1');
const C3000 = quantityCommitment('3000', 's2');

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.seedBatch();
});

async function send(from: IdentitySpec, to: IdentitySpec, commitment: string): Promise<string> {
  const input = h.base({ batchId: 'batch-001', toTenantId: to.tenantId, quantityCommitment: commitment });
  await h.call(from, 'TransferBatch', input);
  return input.eventId as string;
}

const holderHashes = async (): Promise<string[]> =>
  (await h.call(AUTH, 'GetBatch', 'batch-001')).holders.map((x: { holderHash: string }) => x.holderHash).sort();
const pendingKeys = (): string[] => [...h.stub.state.keys()].filter((k) => k.startsWith('PENDING:batch-001:'));

describe('split across several holders', () => {
  it('lets the manufacturer send 5,000 to D1 and 3,000 to D2 and keep its own holding', async () => {
    const t1 = await send(MFR, DIST, C5000);
    const t2 = await send(MFR, D2, C3000);
    await h.respond(DIST, 'AcceptBatch', t1);
    await h.respond(D2, 'AcceptBatch', t2);
    expect(await holderHashes()).toEqual([orgHash('tenant-mfr'), orgHash('tenant-dist'), orgHash('tenant-dist2')].sort());
  });

  it('keeps concurrent pendings side by side and resolves them independently', async () => {
    const t1 = await send(MFR, DIST, C5000);
    const t2 = await send(MFR, D2, C3000);
    expect(pendingKeys()).toHaveLength(2);
    await h.respond(D2, 'RejectBatch', t2);
    expect(pendingKeys()).toEqual([`PENDING:batch-001:${t1}`]);
    await h.respond(DIST, 'AcceptBatch', t1);
    expect(await holderHashes()).toHaveLength(2);
  });

  it('lets an intermediate holder re-transfer (manufacturer -> D1 -> retailer)', async () => {
    await h.respond(DIST, 'AcceptBatch', await send(MFR, DIST, C5000));
    await h.respond(RETAIL, 'AcceptBatch', await send(DIST, RETAIL, C3000));
    expect(await holderHashes()).toHaveLength(3);
    const history = await h.call(AUTH, 'GetBatchHistory', 'batch-001');
    expect(history.map((e: { eventType: string }) => e.eventType)).toEqual([
      'BATCH_REGISTERED', 'TRANSFER_INITIATED', 'TRANSFER_ACCEPTED', 'TRANSFER_INITIATED', 'TRANSFER_ACCEPTED',
    ]);
  });

  it('lets the sender keep transferring after an accept (holding is kept)', async () => {
    await h.respond(DIST, 'AcceptBatch', await send(MFR, DIST, C5000));
    expect((await send(MFR, D2, C3000)).length).toBeGreaterThan(0);
  });

  it('lets a retailer that received the batch record a sale', async () => {
    await h.respond(DIST, 'AcceptBatch', await send(MFR, DIST, C5000));
    await h.respond(RETAIL, 'AcceptBatch', await send(DIST, RETAIL, C3000));
    const sale = h.base({ batchId: 'batch-001', saleCommitment: hash('sale') });
    expect((await h.call(RETAIL, 'RecordRetailSale', sale)).status).toBe('COMMITTED');
  });

  it('rejects a sale by a party that only has a pending (not accepted) transfer', async () => {
    await send(MFR, RETAIL, C3000);
    const sale = h.base({ batchId: 'batch-001', saleCommitment: hash('sale') });
    await expect(h.call(RETAIL, 'RecordRetailSale', sale)).rejects.toThrow(/NOT_HOLDER/);
  });

  it('rejects SOLD_OUT by a holder when other holders exist, allows it for the sole holder', async () => {
    await expect(h.setStatus(MFR, 'SOLD_OUT')).resolves.toMatchObject({ status: 'COMMITTED' });
    const h2 = new Harness();
    await h2.seedBatch();
    await h2.respond(DIST, 'AcceptBatch', await h2.transfer());
    await expect(h2.setStatus(MFR, 'SOLD_OUT')).rejects.toThrow(/NOT_HOLDER/);
  });
});

describe('receiver and one-shot rules', () => {
  it('rejects accept by a different org than the designated receiver', async () => {
    const t1 = await send(MFR, DIST, C5000);
    await expect(h.respond(D2, 'AcceptBatch', t1)).rejects.toThrow(/NOT_RECEIVER/);
  });

  it('rejects a double accept', async () => {
    const t1 = await send(MFR, DIST, C5000);
    await h.respond(DIST, 'AcceptBatch', t1);
    await expect(h.respond(DIST, 'AcceptBatch', t1)).rejects.toThrow(/NO_PENDING_TRANSFER/);
  });

  it('rejects an unknown transfer id', async () => {
    await expect(h.respond(DIST, 'AcceptBatch', 'evt-unknown-1')).rejects.toThrow(/NO_PENDING_TRANSFER/);
  });

  it('treats a replayed TransferBatch as idempotent and a changed one as a mismatch', async () => {
    const input = h.base({ batchId: 'batch-001', toTenantId: 'tenant-dist', quantityCommitment: C5000 });
    await h.call(MFR, 'TransferBatch', input);
    expect((await h.call(MFR, 'TransferBatch', input)).status).toBe('ALREADY_COMMITTED');
    const changed = { ...input, toTenantId: 'tenant-dist2' };
    await expect(h.call(MFR, 'TransferBatch', changed)).rejects.toThrow(/DUPLICATE_EVENT_MISMATCH/);
    expect(pendingKeys()).toHaveLength(1);
  });
});

describe('CancelTransfer', () => {
  it('rejects cancel by a non-sender (including the receiver)', async () => {
    const t1 = await send(MFR, DIST, C5000);
    await expect(h.respond(DIST, 'CancelTransfer', t1)).rejects.toThrow(/NOT_SENDER/);
    await expect(h.respond(D2, 'CancelTransfer', t1)).rejects.toThrow(/NOT_SENDER/);
  });

  it('rejects cancel after accept', async () => {
    const t1 = await send(MFR, DIST, C5000);
    await h.respond(DIST, 'AcceptBatch', t1);
    await expect(h.respond(MFR, 'CancelTransfer', t1)).rejects.toThrow(/NO_PENDING_TRANSFER/);
  });

  it('is one-shot and blocks a later accept', async () => {
    const t1 = await send(MFR, DIST, C5000);
    await h.respond(MFR, 'CancelTransfer', t1);
    await expect(h.respond(MFR, 'CancelTransfer', t1)).rejects.toThrow(/NO_PENDING_TRANSFER/);
    await expect(h.respond(DIST, 'AcceptBatch', t1)).rejects.toThrow(/NO_PENDING_TRANSFER/);
  });

  it('allows a fresh transfer after a cancel', async () => {
    const t1 = await send(MFR, DIST, C5000);
    await h.respond(MFR, 'CancelTransfer', t1);
    const t2 = await send(MFR, DIST, C5000);
    await h.respond(DIST, 'AcceptBatch', t2);
    expect(await holderHashes()).toHaveLength(2);
  });

  it('rejects cancel by a role that is not a transfer party', async () => {
    const t1 = await send(MFR, DIST, C5000);
    await expect(h.respond(AUTH, 'CancelTransfer', t1)).rejects.toThrow(/UNAUTHORIZED_ROLE/);
  });
});

describe('shipments', () => {
  it('rejects a shipment by a party that is not the transfer sender', async () => {
    const t1 = await send(MFR, DIST, C5000);
    const input = h.base({ batchId: 'batch-001', transferEventId: t1 });
    await expect(h.call(DIST, 'RecordShipment', input)).rejects.toThrow(/NOT_SENDER/);
  });
});
