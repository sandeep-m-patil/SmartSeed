import { useQuery } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { formatDate, formatNumber, titleCase } from '../lib/format';
import type { Subscription, Usage } from '../types';
import { StatusBadge } from '../components/Badge';
import { Card, PageHeader } from '../components/Layout';
import { QueryState } from '../components/QueryState';

const NEAR_LIMIT_RATIO = 0.8;

function UsageBar({ name, used, limit }: { name: string; used: number; limit: number | null }) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const isNear = limit != null && used / limit >= NEAR_LIMIT_RATIO;
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{titleCase(name)}</span><span>{formatNumber(used)} / {limit == null ? 'Unlimited' : formatNumber(limit)}{isNear && ' - near limit'}</span></div>
      {limit != null && (
        <div role="progressbar" aria-label={`${titleCase(name)} usage`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} className="mt-1 h-2 overflow-hidden rounded bg-slate-200">
          <div className={`h-full ${isNear ? 'bg-red-600' : 'bg-brand-600'}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function SubscriptionPage() {
  const api = useApi();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api.get<Subscription>('/v1/subscription') });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get<Usage>('/v1/usage') });
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Subscription & Usage" />
      <Card title="Plan">
        <QueryState isLoading={sub.isLoading} error={sub.error} isOptionalEndpoint onRetry={() => void sub.refetch()}>
          {sub.data && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase text-slate-500">Plan</dt><dd className="font-medium">{sub.data.plan.name}</dd></div>
              <div><dt className="text-xs uppercase text-slate-500">Status</dt><dd><StatusBadge status={sub.data.status} /></dd></div>
              {sub.data.trialEndsAt && <div><dt className="text-xs uppercase text-slate-500">Trial ends</dt><dd>{formatDate(sub.data.trialEndsAt)}</dd></div>}
              {sub.data.renewsAt && <div><dt className="text-xs uppercase text-slate-500">Renews</dt><dd>{formatDate(sub.data.renewsAt)}</dd></div>}
            </dl>
          )}
        </QueryState>
      </Card>
      <Card title="Usage">
        <QueryState isLoading={usage.isLoading} error={usage.error} isOptionalEndpoint onRetry={() => void usage.refetch()}>
          <div className="space-y-4">{Object.entries(usage.data ?? {}).map(([k, v]) => <UsageBar key={k} name={k} used={v.used} limit={v.limit} />)}</div>
        </QueryState>
      </Card>
    </div>
  );
}
