import { useQuery } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { formatNumber } from '../lib/format';
import type { RiskAnalytics } from '../types';
import { AlertsTable } from '../components/AlertsTable';
import { DataTable, type Column } from '../components/DataTable';
import { Card, PageHeader, StatCard, StatGrid } from '../components/Layout';
import { QueryState } from '../components/QueryState';
import { RiskBadge } from '../components/RiskBadge';
import { RiskCharts } from '../components/RiskCharts';
import { RiskSummary } from '../components/RiskSummary';

type Flagged = RiskAnalytics['topFlaggedBatches'][number];
type Stakeholder = RiskAnalytics['stakeholderActivity'][number];
type Duplicate = RiskAnalytics['duplicateScans'][number];

const flaggedColumns: Column<Flagged>[] = [
  { key: 'b', header: 'Batch', cell: (r) => r.batchCode },
  { key: 'a', header: 'Alerts', cell: (r) => formatNumber(r.alerts) },
  { key: 's', header: 'Max risk', cell: (r) => <RiskBadge score={r.maxScore} /> },
];
const stakeholderColumns: Column<Stakeholder>[] = [
  { key: 'o', header: 'Organization', cell: (r) => r.orgName },
  { key: 'b', header: 'Blocked attempts', cell: (r) => formatNumber(r.blockedAttempts) },
];
const duplicateColumns: Column<Duplicate>[] = [
  { key: 'b', header: 'Batch', cell: (r) => r.batchCode },
  { key: 'd', header: 'Distinct devices', cell: (r) => formatNumber(r.distinctDevices) },
  { key: 's', header: 'Scans', cell: (r) => formatNumber(r.scans) },
];

function Analytics({ data }: { data: RiskAnalytics }) {
  return (
    <div className="space-y-4">
      <RiskCharts data={data} />
      <StatGrid>
        <StatCard label="Inventory discrepancies" value={formatNumber(data.inventoryMismatches.discrepancies)} />
        <StatCard label="Inventory-mismatch alerts" value={formatNumber(data.inventoryMismatches.alerts)} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top flagged batches">{data.topFlaggedBatches.length ? <DataTable caption="Top flagged batches" columns={flaggedColumns} rows={data.topFlaggedBatches} rowKey={(r) => r.batchId} /> : <p className="text-sm text-slate-500">None.</p>}</Card>
        <Card title="Blocked attempts by organization">{data.stakeholderActivity.length ? <DataTable caption="Blocked attempts" columns={stakeholderColumns} rows={data.stakeholderActivity} rowKey={(r) => r.orgId} /> : <p className="text-sm text-slate-500">None.</p>}</Card>
        <Card title="Duplicate scan patterns">{data.duplicateScans.length ? <DataTable caption="Duplicate scans" columns={duplicateColumns} rows={data.duplicateScans} rowKey={(r) => r.qrId} /> : <p className="text-sm text-slate-500">None.</p>}</Card>
      </div>
    </div>
  );
}

export function RiskManagementPage() {
  const api = useApi();
  const q = useQuery({ queryKey: ['risk-analytics'], queryFn: () => api.get<RiskAnalytics>('/v1/risk/analytics') });
  return (
    <div className="space-y-6">
      <PageHeader title="Risk Management" subtitle="Platform-wide risk posture, anomalies and alerts" />
      <RiskSummary />
      <section aria-labelledby="analytics-h" className="space-y-3">
        <h2 id="analytics-h" className="text-base font-semibold">Analytics</h2>
        <QueryState isLoading={q.isLoading} error={q.error} isOptionalEndpoint onRetry={() => void q.refetch()}>{q.data && <Analytics data={q.data} />}</QueryState>
      </section>
      <section aria-labelledby="alerts-h" className="space-y-3">
        <h2 id="alerts-h" className="text-base font-semibold">Alerts</h2>
        <AlertsTable caption="Platform alerts" />
      </section>
    </div>
  );
}
