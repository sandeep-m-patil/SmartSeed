import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { formatDate, formatDateTime, formatNumber, isExpiringSoon, titleCase } from '../lib/format';
import type { InventoryRow, Movement } from '../types';
import { Badge, StatusBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { PageHeader, Toolbar } from '../components/Layout';
import { QueryState } from '../components/QueryState';
import { SearchBox, matchesSearch } from '../components/SearchBox';

function MovementsDialog({ row, onClose }: { row: InventoryRow | null; onClose(): void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['inventory-movements', row?.batchId], queryFn: () => api.get<Movement[]>(`/v1/inventory/${row?.batchId}/movements`), enabled: Boolean(row) });
  const columns: Column<Movement>[] = [
    { key: 'when', header: 'When', cell: (m) => formatDateTime(m.createdAt) },
    { key: 'reason', header: 'Reason', cell: (m) => titleCase(m.reason) },
    { key: 'delta', header: 'Change', cell: (m) => <span className={m.delta < 0 ? 'text-red-700' : 'text-green-700'}>{m.delta > 0 ? '+' : ''}{formatNumber(m.delta)}</span> },
    { key: 'bal', header: 'Balance', cell: (m) => formatNumber(m.balanceAfter) },
  ];
  return (
    <Dialog open={row !== null} title={`Movements - ${row?.batchCode ?? ''}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} emptyMessage="No movements recorded." onRetry={() => void q.refetch()}>
        <DataTable caption="Inventory movements" columns={columns} rows={q.data ?? []} rowKey={(m) => m.id} />
      </QueryState>
    </Dialog>
  );
}

export function InventoryPage() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const q = useQuery({ queryKey: ['inventory'], queryFn: () => api.get<InventoryRow[]>('/v1/inventory') });
  const rows = (q.data ?? []).filter((r) => matchesSearch(search, r.batchCode, r.productName, r.brand));
  const columns: Column<InventoryRow>[] = [
    { key: 'batch', header: 'Batch', cell: (r) => <span className="font-medium">{r.batchCode}</span> },
    { key: 'product', header: 'Product', cell: (r) => `${r.productName} (${r.brand})` },
    { key: 'avail', header: 'Available', cell: (r) => formatNumber(r.available) },
    { key: 'qty', header: 'On hand', cell: (r) => formatNumber(r.quantity), isSecondary: true },
    { key: 'res', header: 'Reserved', cell: (r) => formatNumber(r.reserved), isSecondary: true },
    {
      key: 'expiry', header: 'Expiry',
      cell: (r) => <span className="flex flex-wrap items-center gap-1">{formatDate(r.expiryDate)}{r.expired ? <Badge tone="danger">Expired</Badge> : isExpiringSoon(r.expiryDate) ? <Badge tone="warning">Expiring soon</Badge> : null}</span>,
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.batchStatus} />, isSecondary: true },
    { key: 'a', header: '', cell: (r) => <Button size="sm" variant="secondary" onClick={() => setSelected(r)}>Movements</Button> },
  ];
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock your organization currently holds" />
      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Batch or product" /></Toolbar>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={rows.length === 0} emptyMessage="No stock on hand." onRetry={() => void q.refetch()}>
        <DataTable caption="Inventory" columns={columns} rows={rows} rowKey={(r) => r.batchId} />
      </QueryState>
      <MovementsDialog row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
