import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useRoles } from '../hooks/useMe';
import { formatDate, formatNumber } from '../lib/format';
import type { Passport } from '../types';
import { StatusBadge } from '../components/Badge';
import { Card, PageHeader } from '../components/Layout';
import { QrPanel } from '../components/QrPanel';
import { QueryState } from '../components/QueryState';
import { RiskBadge } from '../components/RiskBadge';
import { SupplyChainTimeline } from '../components/SupplyChainTimeline';

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}><dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt><dd className="text-slate-900">{v ?? '-'}</dd></div>
      ))}
    </dl>
  );
}

export function PassportView({ passport }: { passport: Passport }) {
  const p = passport;
  return (
    <div className="space-y-4">
      <Card title="Digital product passport">
        <Facts items={[
          ['Product', `${p.productName} (${p.brand})`], ['Crop / variety', `${p.cropType} / ${p.variety}`], ['Category', p.category],
          ['Manufacturer', p.manufacturerName], ['Manufactured', formatDate(p.manufacturingDate)], ['Expiry', formatDate(p.expiryDate)],
          ['Facility', `${p.facility}, ${p.productionLocation}`], ['Initial quantity', `${formatNumber(p.initialQuantity)} ${p.unit}`],
          ['Status', <StatusBadge key="s" status={p.expired ? 'expired' : p.status} />], ['Ledger status', p.ledgerStatus],
          ['Risk', <RiskBadge key="r" score={p.risk?.score ?? null} level={p.risk?.level ?? null} />], ['Record hash', <span key="h" className="break-all font-mono text-xs">{p.recordHash}</span>],
        ]} />
        {p.certifications.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Certifications</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
              {p.certifications.map((c) => <li key={`${c.type}-${c.number}`}>{c.type} - {c.issuer} ({c.number}){c.validTo ? `, valid to ${formatDate(c.validTo)}` : ''}</li>)}
            </ul>
          </div>
        )}
      </Card>
      {p.investigationWarnings.length > 0 && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Open risk warnings</p>
          <ul className="mt-1 list-disc pl-5">{p.investigationWarnings.map((w) => <li key={w.id}>{w.summary} ({w.severity}, {w.status})</li>)}</ul>
        </div>
      )}
      <Card title="Supply-chain timeline"><SupplyChainTimeline events={p.journey} /></Card>
    </div>
  );
}

export function usePassport(batchId: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: ['passport', batchId], queryFn: () => api.get<Passport>(`/v1/batches/${batchId}/passport`), enabled: Boolean(batchId) });
}

export function BatchDetailPage() {
  const { id } = useParams();
  const { can } = useRoles();
  const q = usePassport(id);
  return (
    <div className="space-y-4">
      <PageHeader title={q.data ? `Batch ${q.data.batchCode}` : 'Batch'} subtitle="Passport, supply-chain timeline and QR codes"
        actions={<Link to="/batches" className="text-sm text-brand-700 underline">Back to batches</Link>} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && <PassportView passport={q.data} />}
      </QueryState>
      {id && can('qr:read') && <QrPanel batchId={id} />}
    </div>
  );
}
