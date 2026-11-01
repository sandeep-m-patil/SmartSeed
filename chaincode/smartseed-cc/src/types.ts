import type { Context } from 'fabric-contract-api';
import type { BatchStatus, EventType, ResultStatus, Role } from './constants';

export interface Caller {
  role: Role;
  tenantId: string;
  orgId: string;
}

/** PENDING:{batchId}:{transferEventId} */
export interface PendingTransfer {
  fromTenantId: string;
  toTenantId: string;
  quantityCommitment: string;
}

/** HOLDING:{batchId}:{tenantId} - proves who legitimately held (part of) a batch. */
export interface HoldingState {
  tenantId: string;
  orgId: string;
  quantityCommitment: string;
  sinceSeq: number;
}

export interface LedgerWrite {
  key: string;
  value: unknown;
}

export interface ProductState {
  productId: string;
  ownerTenantId: string;
  createdAtMs: number;
}

export interface BatchState {
  batchId: string;
  productId: string;
  originTenantId: string;
  status: BatchStatus;
  quantityCommitment: string;
  mfgDateMs: number;
  expiryDateMs: number;
  eventSeq: number;
}

export interface EventRecord {
  eventId: string;
  eventType: EventType;
  batchId?: string;
  seq?: number;
  ts: number;
  payloadHash: string;
  recordHash: string;
  actorOrgHash: string;
  fromOrgHash?: string;
  toOrgHash?: string;
  quantityCommitment?: string;
  dbRecordRef?: string;
  signatureRef?: string;
  corrects?: string;
  attrs?: Record<string, string>;
}

export interface EventDraft {
  eventType: EventType;
  batch?: BatchState;
  product?: ProductState;
  fields?: Partial<EventRecord>;
  writes?: LedgerWrite[];
  deletes?: string[];
}

export interface HandlerContext {
  ctx: Context;
  caller: Caller;
  now: number;
}

export interface TxResult {
  status: ResultStatus;
  eventId: string;
  seq?: number;
}
