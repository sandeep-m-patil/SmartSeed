import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../src/audit/audit';
import { sha256Hex } from '../src/lib/crypto';
import { quantityCommitment } from '../src/supply/events';
import { processOutbox } from '../src/blockchain/outbox';
import {
  RegisterProductInput, RegisterBatchInput, TransferInput, TransferResponseInput, ShipmentInput, RetailSaleInput,
} from '../../../chaincode/smartseed-cc/src/schemas';
import { RecordingGateway, silentLogger, testSigner } from './doubles';
import { createHarness, resetData, seedManufacturer, seedPartner, seedTenant, type Harness, type Party } from './helpers';

const VECTORS = JSON.parse(readFileSync(new URL('../../../chaincode/smartseed-cc/test-vectors/canonical-hash.json', import.meta.url), 'utf8')) as {
  cases: { name: string; inputJson: string; canonical: string; expectedHash: string }[];
  quantityCommitments: { quantity: number | string; salt: string; expected?: string; expectedCommitment?: string }[];
};

const SCHEMAS: Record<string, { parse(v: unknown): unknown }> = {
  RegisterProduct: RegisterProductInput, RegisterBatch: RegisterBatchInput, TransferBatch: TransferInput,
  RecordShipment: ShipmentInput, AcceptBatch: TransferResponseInput, RejectBatch: TransferResponseInput,
  CancelTransfer: TransferResponseInput, RecordRetailSale: RetailSaleInput,
};

let h: Harness;
let gw: RecordingGateway;
let mfr: Party;
let d1: Party;
let rt: Party;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const call = (method: 'get' | 'post', path: string, token: string, body?: unknown, key?: string) => {
  const req = request(h.app)[method](`/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return body === undefined ? req : req.send(body as object);
};

beforeEach(async () => {
  await resetData(h);
  gw = new RecordingGateway();
  const tenantId = await seedTenant(h);
  mfr = await seedManufacturer(h, tenantId);
  d1 = await seedPartner(h, tenantId, 'distributor');
  rt = await seedPartner(h, tenantId, 'retailer');
});

describe('hash parity with the chaincode test vectors', () => {
  it('produces the same canonical form and SHA-256 as the chaincode for every shared vector', () => {
    for (const c of VECTORS.cases) {
      const canonical = canonicalJson(JSON.parse(c.inputJson));
      expect(canonical, c.name).toBe(c.canonical);
      expect(sha256Hex(canonical), c.name).toBe(c.expectedHash);
    }
  });

  it('computes quantity commitments the same way as the chaincode', () => {
    for (const q of VECTORS.quantityCommitments) {
      const expected = q.expected ?? q.expectedCommitment;
      expect(quantityCommitment(Number(q.quantity), q.salt)).toBe(expected);
    }
  });
});

describe('every ledger call satisfies the chaincode input schemas', () => {
  it('builds valid inputs for the full journey: register, transfer, ship, accept, onward, sale, reject, cancel', async () => {
    const p = await call('post', '/products', mfr.token, { name: 'Soy', brand: 'SoyKing', cropType: 'Soy', variety: 'S1', category: 'certified' });
    const b = await call('post', '/batches', mfr.token, { productId: p.body.data.id, manufacturingDate: '2026-02-01', expiryDate: '2099-01-01', productionLocation: 'Indore', facility: 'F1', initialQuantity: 500 });
    const batchId = b.body.data.id;
    const ship = { sourceLocation: 'Indore', destinationLocation: 'Bhopal' };
    const t1 = (await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 200 }, randomUUID())).body.data.id;
    await call('post', `/transfers/${t1}/dispatch`, mfr.token, ship);
    await call('post', `/transfers/${t1}/transit`, mfr.token);
    await call('post', `/transfers/${t1}/accept`, d1.token, {});
    const t2 = (await call('post', '/transfers', d1.token, { batchId, toOrgId: rt.orgId, quantity: 50 }, randomUUID())).body.data.id;
    await call('post', `/transfers/${t2}/dispatch`, d1.token, ship);
    await call('post', `/transfers/${t2}/accept`, rt.token, {});
    await call('post', '/sales', rt.token, { batchId, quantity: 10 }, randomUUID());
    const t3 = (await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 20 }, randomUUID())).body.data.id;
    await call('post', `/transfers/${t3}/dispatch`, mfr.token, ship);
    await call('post', `/transfers/${t3}/reject`, d1.token, { reason: 'Damaged packaging' });
    const t4 = (await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 5 }, randomUUID())).body.data.id;
    await call('post', `/transfers/${t4}/cancel`, mfr.token);

    const { signer } = testSigner();
    for (let i = 0; i < 20; i++) await processOutbox({ db: h.db, gateway: gw, signer, logger: silentLogger, usePrivateData: false });

    const fns = gw.calls.map((c) => c.fn);
    expect(new Set(fns)).toEqual(new Set(Object.keys(SCHEMAS)));
    for (const c of gw.calls) expect(() => SCHEMAS[c.fn]?.parse(c.input), `${c.fn} input`).not.toThrow();
    expect((await h.admin.query("SELECT count(*)::int AS n FROM blockchain_transactions WHERE status <> 'committed'")).rows[0].n).toBe(0);
  });
});
