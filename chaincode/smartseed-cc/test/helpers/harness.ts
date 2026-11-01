import type { Context } from 'fabric-contract-api';
import { sha256Hex } from '../../src/canonical';
import { SmartSeedContract } from '../../src/contract';
import { IdentitySpec, MockClientIdentity, MockStub } from './mock-stub';

export const T0 = 1_700_000_000_000;
export const DAY_MS = 86_400_000;
export const hash = (s: string): string => sha256Hex(s);

export const MFR: IdentitySpec = { role: 'manufacturer', tenantId: 'tenant-mfr', orgId: 'org-mfr' };
export const DIST: IdentitySpec = { role: 'distributor', tenantId: 'tenant-dist', orgId: 'org-dist' };
export const RETAIL: IdentitySpec = { role: 'retailer', tenantId: 'tenant-retail', orgId: 'org-retail' };
export const CARRIER: IdentitySpec = { role: 'carrier', tenantId: 'tenant-carrier', orgId: 'org-carrier' };
export const AUTH: IdentitySpec = { role: 'authority', tenantId: 'tenant-auth', orgId: 'org-auth', mspId: 'AuthorityMSP' };
export const ADMIN: IdentitySpec = { role: 'admin', tenantId: 'tenant-admin', orgId: 'org-admin' };
export const GATEWAY: IdentitySpec = { role: 'gateway', tenantId: 'tenant-gw', orgId: 'org-gw' };

type Json = Record<string, unknown>;
type SubmitFn = Exclude<keyof SmartSeedContract, keyof import('fabric-contract-api').Contract>;

export class Harness {
  public readonly stub = new MockStub();
  public readonly contract = new SmartSeedContract();
  private counter = 0;

  constructor() {
    this.stub.setTime(T0);
  }

  nextId(prefix = 'evt'): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(5, '0')}`;
  }

  ctx(identity: IdentitySpec): Context {
    return { stub: this.stub, clientIdentity: new MockClientIdentity(identity) } as unknown as Context;
  }

  /** Invokes a contract function and returns the parsed JSON result. */
  async call(who: IdentitySpec, fn: SubmitFn, ...args: unknown[]): Promise<any> {
    const method = this.contract[fn] as unknown as (c: Context, ...a: unknown[]) => Promise<string>;
    const wire = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));
    return JSON.parse(await method.call(this.contract, this.ctx(who), ...wire));
  }

  base(extra: Json = {}): Json {
    return { eventId: this.nextId(), recordHash: hash(`rec-${this.counter}`), ...extra };
  }

  async registerProduct(productId = 'prod-001', who = MFR): Promise<any> {
    return this.call(who, 'RegisterProduct', this.base({ productId, ownerTenantId: who.tenantId }));
  }

  async registerBatch(batchId = 'batch-001', extra: Json = {}): Promise<any> {
    const input = this.base({
      batchId,
      productId: 'prod-001',
      quantityCommitment: hash('qty-1000|salt'),
      mfgDateMs: T0 - DAY_MS,
      expiryDateMs: T0 + 365 * DAY_MS,
      ...extra,
    });
    return this.call(MFR, 'RegisterBatch', input);
  }

  async seedBatch(batchId = 'batch-001'): Promise<void> {
    await this.registerProduct();
    await this.registerBatch(batchId);
  }

  async transfer(to = DIST, from = MFR, batchId = 'batch-001'): Promise<string> {
    const input = this.base({ batchId, toTenantId: to.tenantId, quantityCommitment: hash('qty-1000|salt') });
    await this.call(from, 'TransferBatch', input);
    return input.eventId as string;
  }

  respond(who: IdentitySpec, fn: 'AcceptBatch' | 'RejectBatch' | 'CancelTransfer', transferEventId: string, batchId = 'batch-001') {
    return this.call(who, fn, this.base({ batchId, transferEventId }));
  }

  setStatus(who: IdentitySpec, newStatus: string, batchId = 'batch-001'): Promise<any> {
    return this.call(who, 'UpdateBatchStatus', this.base({ batchId, newStatus }));
  }
}
