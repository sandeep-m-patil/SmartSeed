import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { formatNumber } from '../lib/format';
import type { RiskOverview } from '../types';
import { QueryState } from './QueryState';
import { StatCard, StatGrid } from './Layout';

/** Risk KPIs straight from GET /v1/risk/overview. Shows an "unavailable" state while that endpoint is not deployed. */
export function RiskSummary({ detailsPath }: { detailsPath?: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['risk-overview'], queryFn: () => api.get<RiskOverview>('/v1/risk/overview') });
  const d = q.data;
  return (
    <section aria-labelledby="risk-summary-h" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 id="risk-summary-h" className="text-base font-semibold">Risk overview</h2>
        {detailsPath && <Link to={detailsPath} className="text-sm text-brand-700 underline">View details</Link>}
      </div>
      <QueryState isLoading={q.isLoading} error={q.error} isOptionalEndpoint onRetry={() => void q.refetch()}>
        {d && (
          <StatGrid>
            <StatCard label="Total batches" value={formatNumber(d.totalBatches)} />
            <StatCard label="Total scans" value={formatNumber(d.totalScans)} />
            <StatCard label="Suspicious scans" value={formatNumber(d.suspiciousScans)} />
            <StatCard label="High-risk batches" value={formatNumber(d.highRiskBatches)} tone={d.highRiskBatches > 0 ? 'danger' : 'default'} />
            <StatCard label="Critical alerts" value={formatNumber(d.criticalAlerts)} tone={d.criticalAlerts > 0 ? 'danger' : 'default'} />
            <StatCard label="Investigations" value={formatNumber(d.investigations.total)} />
            <StatCard label="Resolved" value={formatNumber(d.investigations.resolved)} />
            <StatCard label="Pending" value={formatNumber(d.investigations.pending)} />
          </StatGrid>
        )}
      </QueryState>
    </section>
  );
}
