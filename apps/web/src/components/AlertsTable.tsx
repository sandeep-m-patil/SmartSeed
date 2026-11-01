import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from '../hooks/useAction';
import { useMe, useRoles } from '../hooks/useMe';
import { usePagedList } from '../hooks/usePagedList';
import { formatDateTime, titleCase } from '../lib/format';
import { RISK_LEVELS, RISK_META } from '../lib/risk';
import type { Alert } from '../types';
import { StatusBadge } from './Badge';
import { Button } from './Button';
import { DataTable, type Column } from './DataTable';
import { SelectField, TextField } from './Field';
import { Toolbar } from './Layout';
import { Pagination } from './Pagination';
import { QueryState } from './QueryState';
import { RiskBadge } from './RiskBadge';
import { SearchBox, matchesSearch } from './SearchBox';

const LEVEL_OPTIONS = RISK_LEVELS.map((l) => ({ value: l, label: RISK_META[l].label }));
const STATUS_OPTIONS = ['open', 'investigating', 'resolved', 'dismissed'].map((s) => ({ value: s, label: titleCase(s) }));
export const INVESTIGATION_STATUSES = ['open', 'under_investigation', 'verification_requested', 'confirmed_suspicious', 'false_positive', 'escalated_manufacturer', 'escalated_authority', 'resolved'].map((s) => ({ value: s, label: titleCase(s) }));

const toIsoStart = (d: string): string => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const toIsoEnd = (d: string): string => (d ? new Date(`${d}T23:59:59`).toISOString() : '');

interface Props {
  caption: string;
}

/** Filterable, paginated alert list wired to GET /v1/alerts (risk backend contract). */
export function AlertsTable({ caption }: Props) {
  const { can } = useRoles();
  const me = useMe();
  const [filters, setFilters] = useState({ level: '', status: '', from: '', to: '', investigationStatus: '' });
  const [search, setSearch] = useState('');
  const set = (k: keyof typeof filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const list = usePagedList<Alert>({ queryKey: 'alerts', path: '/v1/alerts', params: { ...filters, from: toIsoStart(filters.from), to: toIsoEnd(filters.to) } });
  const assign = useAction<{ id: string; assigneeId: string }>({
    run: ({ id, assigneeId }, api) => api.send(`/v1/alerts/${id}`, { method: 'PATCH', body: { assigneeId } }),
    success: 'Alert assigned to you',
    invalidate: ['alerts'],
  });
  const rows = list.items
    .filter((a) => matchesSearch(search, a.batchCode, a.productName, a.alertType, a.summary, a.assigneeName));

  const columns: Column<Alert>[] = [
    { key: 'risk', header: 'Risk', cell: (a) => <RiskBadge score={a.riskScore} level={a.severity} /> },
    { key: 'batch', header: 'Batch', cell: (a) => <><span className="font-medium">{a.batchCode}</span><span className="block text-xs text-slate-500">{a.productName}</span></> },
    { key: 'type', header: 'Alert', cell: (a) => <><span>{titleCase(a.alertType)}</span><span className="block max-w-xs truncate text-xs text-slate-500" title={a.summary}>{a.summary}</span></> },
    { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
    { key: 'when', header: 'Detected', cell: (a) => formatDateTime(a.detectedAt), isSecondary: true },
    { key: 'who', header: 'Assignee', cell: (a) => a.assigneeName ?? <span className="text-slate-400">Unassigned</span>, isSecondary: true },
    {
      key: 'act', header: 'Actions',
      cell: (a) => (
        <div className="flex flex-wrap gap-1">
          {a.investigationId && <Link to={`/investigations/${a.investigationId}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">Investigation</Link>}
          {can('alert:manage') && me.data && a.assigneeId !== me.data.id && <Button size="sm" variant="secondary" isLoading={assign.isPending && assign.variables?.id === a.id} onClick={() => assign.mutate({ id: a.id, assigneeId: me.data.id })}>Assign to me</Button>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Batch, product, type" />
        <div className="w-36"><SelectField label="Risk level" value={filters.level} onChange={(e) => set('level')(e.target.value)} options={LEVEL_OPTIONS} placeholder="All levels" /></div>
        <div className="w-40"><SelectField label="Status" value={filters.status} onChange={(e) => set('status')(e.target.value)} options={STATUS_OPTIONS} placeholder="All statuses" /></div>
        <div className="w-40"><SelectField label="Investigation" value={filters.investigationStatus} onChange={(e) => set('investigationStatus')(e.target.value)} options={INVESTIGATION_STATUSES} placeholder="Any" /></div>
        <div className="w-40"><TextField label="From" type="date" value={filters.from} onChange={(e) => set('from')(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={filters.to} onChange={(e) => set('to')(e.target.value)} /></div>
      </Toolbar>
      {assign.errorText && <p role="alert" className="mb-2 text-sm text-red-700">{assign.errorText}</p>}
      <QueryState isLoading={list.isLoading} error={list.error} isOptionalEndpoint isEmpty={rows.length === 0} emptyMessage="No alerts match these filters." onRetry={list.refetch}>
        <DataTable caption={caption} columns={columns} rows={rows} rowKey={(a) => a.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
    </div>
  );
}
