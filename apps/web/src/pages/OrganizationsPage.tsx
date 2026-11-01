import { useState } from 'react';
import { useAction } from '../hooks/useAction';
import { usePagedList } from '../hooks/usePagedList';
import { useRoles } from '../hooks/useMe';
import { formatDate } from '../lib/format';
import { Button } from '../components/Button';
import { ChangePlanDialog } from '../components/ChangePlanDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, type Column } from '../components/DataTable';
import { SelectField } from '../components/Field';
import { PageHeader, Toolbar } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { SearchBox, matchesSearch } from '../components/SearchBox';
import { StatusBadge } from '../components/Badge';
import type { Tenant } from '../types';

type NextStatus = 'active' | 'suspended';
interface Pending { tenant: Tenant; next: NextStatus }

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending approval' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

function actionLabel(t: Tenant): { label: string; next: NextStatus } {
  if (t.status === 'active') return { label: 'Suspend', next: 'suspended' };
  return { label: t.status === 'pending' ? 'Approve' : 'Reactivate', next: 'active' };
}

export function OrganizationsPage() {
  const { can } = useRoles();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [planTenant, setPlanTenant] = useState<Tenant | null>(null);
  const list = usePagedList<Tenant>({ queryKey: 'tenants', path: '/v1/platform/tenants', params: { status } });
  const change = useAction<Pending>({
    run: ({ tenant, next }, api) => api.send(`/v1/platform/tenants/${tenant.id}`, { method: 'PATCH', body: { status: next } }),
    success: (_r, { tenant, next }) => `${tenant.name} is now ${next}`,
    invalidate: ['tenants', 'snapshot'],
    onDone: () => setPending(null),
  });
  const rows = list.items.filter((t) => matchesSearch(search, t.name, t.slug));

  const columns: Column<Tenant>[] = [
    { key: 'name', header: 'Name', cell: (t) => <span className="font-medium">{t.name}</span> },
    { key: 'slug', header: 'Slug', cell: (t) => t.slug, isSecondary: true },
    { key: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
    { key: 'created', header: 'Registered', cell: (t) => formatDate(t.created_at), isSecondary: true },
    {
      key: 'action', header: 'Action',
      cell: (t) => {
        const a = actionLabel(t);
        return (
          <div className="flex flex-wrap gap-1">
            {can('platform:billing:manage') && <Button size="sm" variant="secondary" onClick={() => setPlanTenant(t)}>Change plan</Button>}
            {can('platform:tenant:write')
          ? <Button size="sm" variant={a.next === 'suspended' ? 'danger' : 'secondary'} onClick={() => { change.reset(); setPending({ tenant: t, next: a.next }); }}>{a.label}</Button>
          : null}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Organizations" subtitle="Approve, suspend and reactivate tenant organizations" />
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Name or slug" />
        <div className="w-48"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} placeholder="All statuses" /></div>
      </Toolbar>
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={rows.length === 0} emptyMessage="No organizations match." onRetry={list.refetch}>
        <DataTable caption="Tenant organizations" columns={columns} rows={rows} rowKey={(t) => t.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
      <ChangePlanDialog tenant={planTenant} onClose={() => setPlanTenant(null)} />
      <ConfirmDialog
        open={pending !== null}
        title={pending?.next === 'suspended' ? 'Suspend organization?' : 'Activate organization?'}
        message={pending ? <>{pending.next === 'suspended' ? 'Users of ' : 'This will allow users of '}<strong>{pending.tenant.name}</strong>{pending.next === 'suspended' ? ' will lose access immediately.' : ' to sign in.'}</> : null}
        confirmLabel={pending?.next === 'suspended' ? 'Suspend' : 'Activate'}
        isDanger={pending?.next === 'suspended'}
        isBusy={change.isPending}
        error={change.errorText}
        onConfirm={() => pending && change.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
