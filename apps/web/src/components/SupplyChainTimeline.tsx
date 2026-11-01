import type { JourneyEvent } from '../types';
import { formatDateTime, formatNumber, shortId, titleCase } from '../lib/format';
import { ChainStatusBadge } from './ChainStatusBadge';

const EVENT_LABELS: Record<string, string> = {
  batch_registered: 'Batch registered',
  transfer_created: 'Transfer created',
  transfer_dispatched: 'Dispatched',
  transfer_in_transit: 'In transit',
  transfer_received: 'Received',
  transfer_rejected: 'Rejected',
  transfer_cancelled: 'Cancelled',
  retail_sale: 'Retail sale',
};

const eventLabel = (type: string): string => EVENT_LABELS[type] ?? titleCase(type);

function Counterparty({ event }: { event: JourneyEvent }) {
  if (!event.actorName && !event.counterpartyName) return null;
  return (
    <p className="text-sm text-slate-600">
      {event.actorName ?? 'Unknown organization'}
      {event.counterpartyName ? <> &rarr; {event.counterpartyName}</> : null}
    </p>
  );
}

/** Vertical supply-chain timeline; each event carries its own ledger status badge. */
export function SupplyChainTimeline({ events }: { events: JourneyEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">No supply-chain events recorded yet.</p>;
  return (
    <ol aria-label="Supply chain timeline" className="relative space-y-4 border-l-2 border-slate-200 pl-5">
      {events.map((e) => (
        <li key={e.sequence} className="relative" data-testid="timeline-event">
          <span aria-hidden className="absolute -left-[1.65rem] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-600 ring-2 ring-brand-600" />
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900">{eventLabel(e.eventType)}</h4>
            <ChainStatusBadge status={e.chainStatus} txId={e.chainTxId} />
          </div>
          <time dateTime={e.occurredAt} className="text-xs text-slate-500">{formatDateTime(e.occurredAt)}</time>
          <Counterparty event={e} />
          {e.quantity != null && <p className="text-sm text-slate-600">Quantity: {formatNumber(e.quantity)}</p>}
          {e.chainTxId && <p className="break-all text-xs text-slate-500">Tx {shortId(e.chainTxId)}{e.blockNumber != null ? ` - block ${e.blockNumber}` : ''}</p>}
        </li>
      ))}
    </ol>
  );
}
