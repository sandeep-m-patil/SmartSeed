import { chainDisplay } from '../lib/chain';
import { Badge } from './Badge';

/** Ledger status pill. Wording comes from chainDisplay so "Confirmed" can only appear for committed + tx id. */
export function ChainStatusBadge({ status, txId }: { status: string | null | undefined; txId?: string | null }) {
  const { label, tone } = chainDisplay(status, txId);
  return <Badge tone={tone}>{label}</Badge>;
}
