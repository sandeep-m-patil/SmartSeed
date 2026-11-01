export interface SubmitResult {
  /** 'COMMITTED' for a fresh commit, 'ALREADY_COMMITTED' when the chaincode recognised the eventId. */
  status: 'COMMITTED' | 'ALREADY_COMMITTED';
  txId: string;
  blockNumber: number | null;
  validationCode: string;
}

/** Thrown by gateway implementations; `retryable` tells the outbox whether to back off or fail permanently. */
export class ChainError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string) {
    super(message);
  }
}

export interface SubmitRequest {
  /** Organization whose Fabric identity signs the transaction. */
  orgId: string;
  fn: string;
  input: Record<string, unknown>;
  /** Optional transient data for private data collections (quantity, salt). */
  transient?: Record<string, string>;
}

/**
 * The only seam between the application and the ledger. Production uses FabricGateway
 * (real peers); tests inject a recording double that never ships in a runtime build.
 */
export interface LedgerGateway {
  submit(req: SubmitRequest): Promise<SubmitResult>;
  evaluate(orgId: string, fn: string, args: string[]): Promise<string>;
}
