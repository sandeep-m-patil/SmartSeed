import { Link } from 'react-router-dom';
import { useListSnapshot, formatCount, type CountResult } from '../hooks/useCount';
import { useRoles } from '../hooks/useMe';
import { isExpiringSoon } from '../lib/format';
import { PageHeader, StatCard, StatGrid } from '../components/Layout';
import { RiskSummary } from '../components/RiskSummary';
import { Spinner } from '../components/QueryState';
import { ApiError } from '../api';
import type { Batch, InventoryRow, Product, Tenant, Transfer } from '../types';

function Stat<T>({ label, snap, to, hint }: { label: string; snap: CountResult<T>; to: string; hint?: string }) {
  if (snap.isLoading) return <StatCard label={label} value="..." />;
  if (snap.error) return <StatCard label={label} value="n/a" hint={snap.error instanceof ApiError ? snap.error.message : 'Could not load'} />;
  return (
    <Link to={to} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
      <StatCard label={label} value={formatCount(snap.count, snap.hasMore)} {...(hint ? { hint } : {})} />
    </Link>
  );
}

function PlatformOverview() {
  const all = useListSnapshot<Tenant>('tenants', '/v1/platform/tenants');
  const pending = useListSnapshot<Tenant>('tenants-pending', '/v1/platform/tenants', { status: 'pending' });
  const suspended = useListSnapshot<Tenant>('tenants-suspended', '/v1/platform/tenants', { status: 'suspended' });
  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" subtitle="Tenants and risk across the platform" />
      <StatGrid>
        <Stat label="Organizations" snap={all} to="/organizations" />
        <Stat label="Awaiting approval" snap={pending} to="/organizations" />
        <Stat label="Suspended" snap={suspended} to="/organizations" />
      </StatGrid>
      <RiskSummary detailsPath="/risk-management" />
    </div>
  );
}

function OrgDashboard() {
  const { can } = useRoles();
  const batches = useListSnapshot<Batch>('batches', '/v1/batches', {}, can('batch:read'));
  const products = useListSnapshot<Product>('products', '/v1/products', {}, can('product:write'));
  const inventory = useListSnapshot<InventoryRow>('inventory', '/v1/inventory', {}, can('inventory:read'));
  const incoming = useListSnapshot<Transfer>('transfers-incoming', '/v1/transfers', { direction: 'incoming' }, can('transfer:receive'));
  const outgoing = useListSnapshot<Transfer>('transfers-outgoing', '/v1/transfers', { direction: 'outgoing' }, can('transfer:create'));
  const awaiting = incoming.items.filter((t) => t.status === 'dispatched' || t.status === 'in_transit');
  const toDispatch = outgoing.items.filter((t) => t.status === 'created');
  const stock = inventory.items.reduce((sum, r) => sum + r.available, 0);
  const expiring = inventory.items.filter((r) => !r.expired && isExpiringSoon(r.expiryDate)).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Live figures from your organization's records" />
      <StatGrid>
        {can('batch:read') && <Stat label="Batches" snap={batches} to={can('qr:read') || can('batch:create') ? '/batches' : '/inventory'} />}
        {can('product:write') && <Stat label="Products" snap={products} to="/products" />}
        {can('inventory:read') && <Stat label="Stocked batches" snap={inventory} to="/inventory" hint={inventory.isLoading ? undefined : `${stock.toLocaleString()} units available`} />}
        {can('inventory:read') && !inventory.isLoading && <StatCard label="Expiring in 30 days" value={expiring} tone={expiring > 0 ? 'danger' : 'default'} />}
        {can('transfer:receive') && <Stat label="Awaiting receipt" snap={{ ...incoming, items: awaiting, count: awaiting.length }} to={incomingPath(can)} />}
        {can('transfer:create') && <Stat label="Ready to dispatch" snap={{ ...outgoing, items: toDispatch, count: toDispatch.length }} to="/transfers" />}
      </StatGrid>
      {can('risk:read') && <RiskSummary {...(can('alert:read') ? { detailsPath: '/alerts' } : {})} />}
      {batches.isLoading && inventory.isLoading && <Spinner />}
    </div>
  );
}

const incomingPath = (can: (p: 'transfer:create') => boolean): string => (can('transfer:create') ? '/incoming' : '/received');

export function DashboardPage() {
  const { roles } = useRoles();
  return roles.includes('platform_admin') ? <PlatformOverview /> : <OrgDashboard />;
}
