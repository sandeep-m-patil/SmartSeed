import { BatchStatus, ErrorCode } from './constants';
import { ContractError } from './errors';
import type { BatchState } from './types';

/** Legal status transitions (UpdateBatchStatus / investigation outcomes). */
export const TRANSITIONS: Readonly<Record<BatchStatus, readonly BatchStatus[]>> = {
  [BatchStatus.Active]: [
    BatchStatus.Held,
    BatchStatus.Recalled,
    BatchStatus.Revoked,
    BatchStatus.Expired,
    BatchStatus.SoldOut,
  ],
  [BatchStatus.Held]: [BatchStatus.Active, BatchStatus.Recalled, BatchStatus.Revoked, BatchStatus.Expired],
  [BatchStatus.Recalled]: [BatchStatus.Revoked],
  [BatchStatus.Revoked]: [],
  [BatchStatus.Expired]: [],
  [BatchStatus.SoldOut]: [],
};

export function canTransition(from: BatchStatus, to: BatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BatchStatus, to: BatchStatus): void {
  if (!canTransition(from, to)) {
    throw new ContractError(ErrorCode.IllegalTransition, `${from} -> ${to} is not allowed`);
  }
}

const STATUS_ERRORS: Partial<Record<BatchStatus, ErrorCode>> = {
  [BatchStatus.Revoked]: ErrorCode.BatchRevoked,
  [BatchStatus.Held]: ErrorCode.BatchHeld,
  [BatchStatus.Expired]: ErrorCode.BatchExpired,
};

/** Batch must be ACTIVE and not past its expiry date (as of the tx timestamp). */
export function assertTradable(batch: BatchState, nowMs: number): void {
  const code = STATUS_ERRORS[batch.status];
  if (code) throw new ContractError(code, `batch ${batch.batchId} is ${batch.status}`);
  if (batch.status !== BatchStatus.Active) {
    throw new ContractError(ErrorCode.BatchNotActive, `batch ${batch.batchId} is ${batch.status}`);
  }
  if (nowMs >= batch.expiryDateMs) {
    throw new ContractError(ErrorCode.BatchExpired, `batch ${batch.batchId} is past its expiry date`);
  }
}
