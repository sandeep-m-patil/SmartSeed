export type ChainTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

export interface ChainDisplay {
  label: string;
  tone: ChainTone;
}

/**
 * The only place that decides how ledger status is worded. "Confirmed" is reserved for a
 * transaction the ledger reports as committed AND for which we hold a transaction id.
 */
export function chainDisplay(status: string | null | undefined, txId?: string | null): ChainDisplay {
  switch (status) {
    case 'committed':
      return txId ? { label: 'Confirmed on ledger', tone: 'success' } : { label: 'Committed - transaction id missing', tone: 'warning' };
    case 'submitted':
      return { label: 'Submitted - awaiting commit', tone: 'info' };
    case 'pending':
      return { label: 'Pending', tone: 'neutral' };
    case 'failed':
      return { label: 'Failed', tone: 'danger' };
    case null:
    case undefined:
      return { label: 'Not anchored', tone: 'neutral' };
    default:
      return { label: 'Unknown status', tone: 'warning' };
  }
}
