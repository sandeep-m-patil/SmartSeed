import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePagedList } from '../hooks/usePagedList';
import { formatDateTime, titleCase } from '../lib/format';
import type { Investigation } from '../types';
import { INVESTIGATION_STATUSES } from '../components/AlertsTable';
import { Badge, StatusBadge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';
import { SelectField } from '../components/Field';
import { PageHeader, Toolbar } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { RiskBadge } from '../components/RiskBadge';

const columns: Column<Investigation>[] = [
  { key: 'risk', header: 'Risk', cell: (i) => <RiskBadge score={i.report.riskScore} /> },
  { key: 'type', header: 'Category', cell: (i) => <><span>{titleCase(i.report.riskCategory)}</span><span className="block max-w-xs truncate text-xs text-slate-500" title={i.report.mainSuspiciousActivity}>{i.report.mainSuspiciousActivity}</span></> },
  { key: 'status', header: 'Status', cell: (i) => <span className="flex flex-wrap gap-1"><StatusBadge status={i.status} />{i.requiresHumanReview && <Badge tone="info">Needs review</Badge>}</span> },
  { key: 'created', header: 'Opened', cell: (i) => formatDateTime(i.createdAt), isSecondary: true },
  { key: 'open', header: '', cell: (i) => <Link to={`/investigations/${i.id}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">Open</Link> },
];

export function InvestigationsPage() {
  const [status, setStatus] = useState('');
  const list = usePagedList<Investigation>({ queryKey: 'investigations', path: '/v1/investigations', params: { status } });
  return (
    <div>
      <PageHeader title="Investigations" subtitle="Investigation reports awaiting or after human review" />
      <Toolbar>
        <div className="w-56"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={INVESTIGATION_STATUSES} placeholder="All statuses" /></div>
      </Toolbar>
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={list.items.length === 0} emptyMessage="No investigations." onRetry={list.refetch}>
        <DataTable caption="Investigations" columns={columns} rows={list.items} rowKey={(i) => i.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
    </div>
  );
}
