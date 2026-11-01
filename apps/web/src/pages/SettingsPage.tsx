import { useMe } from '../hooks/useMe';
import { usePagedList } from '../hooks/usePagedList';
import { formatDateTime, titleCase } from '../lib/format';
import type { AuditEntry } from '../types';
import { DataTable, type Column } from '../components/DataTable';
import { Card, PageHeader } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';

const columns: Column<AuditEntry>[] = [
  { key: 'when', header: 'When', cell: (a) => formatDateTime(a.created_at ?? a.createdAt) },
  { key: 'action', header: 'Action', cell: (a) => <span className="font-medium">{a.action}</span> },
  { key: 'entity', header: 'Entity', cell: (a) => titleCase(a.entityType ?? a.entity_type ?? '-'), isSecondary: true },
];

export function SettingsPage() {
  const me = useMe();
  const audit = usePagedList<AuditEntry>({ queryKey: 'platform-audit', path: '/v1/platform/audit-logs' });
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Your account and the platform audit trail" />
      <Card title="Account">
        {me.data && (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs uppercase text-slate-500">Name</dt><dd>{me.data.fullName}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Email</dt><dd>{me.data.email}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Roles</dt><dd>{me.data.roles.map(titleCase).join(', ')}</dd></div>
          </dl>
        )}
      </Card>
      <Card title="Platform audit log">
        <QueryState isLoading={audit.isLoading} error={audit.error} isEmpty={audit.items.length === 0} emptyMessage="No audit entries." onRetry={audit.refetch}>
          <DataTable caption="Platform audit log" columns={columns} rows={audit.items} rowKey={(a) => a.id} />
          <Pagination pager={audit.pager} nextCursor={audit.nextCursor} isFetching={audit.isFetching} />
        </QueryState>
      </Card>
    </div>
  );
}
