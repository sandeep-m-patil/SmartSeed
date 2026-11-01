import { useState } from 'react';
import { useMe, useRoles } from '../hooks/useMe';
import { usePagedList } from '../hooks/usePagedList';
import { formatDateTime, formatNumber } from '../lib/format';
import type { Transfer } from '../types';
import { StatusBadge, Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { SelectField } from '../components/Field';
import { PageHeader, Toolbar } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { SearchBox, matchesSearch } from '../components/SearchBox';
import { CreateTransferDialog } from '../components/transfers/CreateTransferDialog';
import { TransferRowActions, type Direction } from '../components/transfers/TransferRowActions';

const STATUS_OPTIONS = ['created', 'dispatched', 'in_transit', 'received', 'rejected', 'cancelled'].map((s) => ({ value: s, label: s.replace('_', ' ') }));

interface Props {
  title: string;
  subtitle: string;
  /** Fixed direction (Incoming/Received Batches); otherwise the page offers an outgoing/incoming switch. */
  fixedDirection?: Direction;
}

export function TransfersPage({ title, subtitle, fixedDirection }: Props) {
  const { can } = useRoles();
  const canCreate = can('transfer:create');
  const canReceive = can('transfer:receive');
  const orgType = useMe().data?.orgType;
  const defaultDirection: Direction = fixedDirection ?? (orgType === 'retailer' || (!canCreate && canReceive) ? 'incoming' : 'outgoing');
  const [direction, setDirection] = useState<Direction>(defaultDirection);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const list = usePagedList<Transfer>({ queryKey: 'transfers', path: '/v1/transfers', params: { direction, status } });
  const rows = list.items.filter((t) => matchesSearch(search, t.batchCode, t.fromOrgName, t.toOrgName));
  const counterpartyOf = (t: Transfer) => (direction === 'outgoing' ? t.toOrgName : t.fromOrgName) ?? '-';

  const columns: Column<Transfer>[] = [
    { key: 'batch', header: 'Batch', cell: (t) => <span className="font-medium">{t.batchCode ?? '-'}</span> },
    { key: 'party', header: direction === 'outgoing' ? 'To' : 'From', cell: counterpartyOf },
    { key: 'qty', header: 'Quantity', cell: (t) => <>{formatNumber(t.quantity)}{t.receivedQuantity != null && t.receivedQuantity !== t.quantity ? <span className="block text-xs text-yellow-800">received {formatNumber(t.receivedQuantity)}</span> : null}</> },
    { key: 'status', header: 'Status', cell: (t) => <span className="flex flex-wrap gap-1"><StatusBadge status={t.status} />{t.underInvestigation && <Badge tone="danger">Under investigation</Badge>}</span> },
    { key: 'created', header: 'Created', cell: (t) => formatDateTime(t.createdAt), isSecondary: true },
    { key: 'actions', header: 'Actions', cell: (t) => <TransferRowActions transfer={t} direction={direction} canCreate={canCreate} canReceive={canReceive} /> },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={canCreate && fixedDirection !== 'incoming' && <Button onClick={() => setIsCreating(true)}>Create transfer</Button>} />
      <Toolbar>
        {!fixedDirection && (
          <div role="group" aria-label="Direction" className="flex overflow-hidden rounded-md border border-slate-300">
            {(['outgoing', 'incoming'] as Direction[]).map((d) => (
              <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)}
                className={`px-3 py-2 text-sm capitalize ${direction === d ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{d}</button>
            ))}
          </div>
        )}
        <SearchBox value={search} onChange={setSearch} placeholder="Batch or organization" />
        <div className="w-44"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} placeholder="All statuses" /></div>
      </Toolbar>
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={rows.length === 0} emptyMessage="No transfers found." onRetry={list.refetch}>
        <DataTable caption={title} columns={columns} rows={rows} rowKey={(t) => t.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
      <CreateTransferDialog open={isCreating} onClose={() => setIsCreating(false)} />
    </div>
  );
}
