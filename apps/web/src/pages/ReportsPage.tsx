import { useQuery } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { useListSnapshot, formatCount } from '../hooks/useCount';
import { formatDate, formatNumber, isExpiringSoon } from '../lib/format';
import type { InventoryRow, Transfer } from '../types';
import { Card, PageHeader, StatCard, StatGrid } from '../components/Layout';
import { DataTable, type Column } from '../components/DataTable';
import { QueryState } from '../components/QueryState';
import { StatusBadge } from '../components/Badge';

/** Retailer reports, computed from live inventory and transfer data (no separate reporting endpoint exists). */
export function ReportsPage() {
  const api = useApi();
  const inv = useQuery({ queryKey: ['inventory'], queryFn: () => api.get<InventoryRow[]>('/v1/inventory') });
  const received = useListSnapshot<Transfer>('transfers-received', '/v1/transfers', { direction: 'incoming', status: 'received' });
  const rows = inv.data ?? [];
  const totalUnits = rows.reduce((s, r) => s + r.quantity, 0);
  const expired = rows.filter((r) => r.expired);
  const expiring = rows.filter((r) => !r.expired && isExpiringSoon(r.expiryDate));
  const variances = received.items.filter((t) => t.receivedQuantity != null && t.receivedQuantity !== t.quantity);

  const attention = [...expired, ...expiring];
  const columns: Column<InventoryRow>[] = [
    { key: 'b', header: 'Batch', cell: (r) => r.batchCode },
    { key: 'p', header: 'Product', cell: (r) => r.productName },
    { key: 'q', header: 'On hand', cell: (r) => formatNumber(r.quantity) },
    { key: 'e', header: 'Expiry', cell: (r) => formatDate(r.expiryDate) },
    { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.expired ? 'expired' : 'expiring_soon'} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Stock position and receiving summary" />
      <QueryState isLoading={inv.isLoading} error={inv.error} onRetry={() => void inv.refetch()}>
        <StatGrid>
          <StatCard label="Batches in stock" value={rows.length} />
          <StatCard label="Units on hand" value={formatNumber(totalUnits)} />
          <StatCard label="Expired batches" value={expired.length} tone={expired.length > 0 ? 'danger' : 'default'} />
          <StatCard label="Expiring in 30 days" value={expiring.length} />
          <StatCard label="Batches received" value={received.isLoading ? '...' : formatCount(received.count, received.hasMore)} />
          <StatCard label="Receipts with variance" value={received.isLoading ? '...' : variances.length} tone={variances.length > 0 ? 'danger' : 'default'} />
        </StatGrid>
        <Card title="Needs attention">
          {attention.length === 0 ? <p className="text-sm text-slate-500">No expired or soon-to-expire stock.</p> : <DataTable caption="Stock needing attention" columns={columns} rows={attention} rowKey={(r) => r.batchId} />}
        </Card>
      </QueryState>
    </div>
  );
}
