import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../api';
import { extractQrToken } from '../lib/qrToken';
import { formatDate, formatDateTime, titleCase } from '../lib/format';
import { Badge, type Tone } from '../components/Badge';
import { Button } from '../components/Button';
import { TextField } from '../components/Field';
import { Card, PageHeader } from '../components/Layout';
import { RiskBadge } from '../components/RiskBadge';

interface Verification {
  product: { name: string; brand: string; cropType: string; variety: string } | null;
  manufacturer: { name: string } | null;
  batch: { code: string; mfgDate: string; expiryDate: string; expired: boolean } | null;
  package?: { serialNo: number | null } | null;
  journey: { step: string; orgType: string; at: string }[];
  verification: { digitalIdentity: string; blockchain: string; scanActivity: string; investigation: string };
  risk: { score: number; level: string; assessed: boolean };
  indicator: 'GREEN' | 'YELLOW' | 'RED';
  warnings: string[];
  asOf: string;
}

const INDICATOR: Record<Verification['indicator'], { label: string; tone: Tone; text: string }> = {
  GREEN: { label: 'Verified', tone: 'success', text: 'All checks passed.' },
  YELLOW: { label: 'Caution', tone: 'warning', text: 'Some checks are incomplete. Review the warnings before selling.' },
  RED: { label: 'Do not sell', tone: 'danger', text: 'One or more checks failed. Do not sell this product; report it to the manufacturer.' },
};

function Result({ r }: { r: Verification }) {
  const ind = INDICATOR[r.indicator];
  return (
    <div className="space-y-4" data-testid="verification-result">
      <div role="status" className={`rounded-lg border p-4 ${r.indicator === 'RED' ? 'border-red-300 bg-red-50' : r.indicator === 'YELLOW' ? 'border-yellow-300 bg-yellow-50' : 'border-green-300 bg-green-50'}`}>
        <div className="flex items-center gap-2"><Badge tone={ind.tone}>{ind.label}</Badge><span className="text-sm">{ind.text}</span></div>
        {r.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{r.warnings.map((w) => <li key={w}>{titleCase(w)}</li>)}</ul>}
      </div>
      <Card title="Product">
        {r.product && r.batch ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs uppercase text-slate-500">Product</dt><dd>{r.product.name} ({r.product.brand})</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Crop / variety</dt><dd>{r.product.cropType} / {r.product.variety}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Manufacturer</dt><dd>{r.manufacturer?.name ?? '-'}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Batch</dt><dd>{r.batch.code}{r.package?.serialNo != null ? ` / pack ${r.package.serialNo}` : ''}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Manufactured</dt><dd>{formatDate(r.batch.mfgDate)}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Expiry</dt><dd>{formatDate(r.batch.expiryDate)} {r.batch.expired && <Badge tone="danger">Expired</Badge>}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Risk</dt><dd><RiskBadge score={r.risk.assessed ? r.risk.score : null} level={r.risk.assessed ? r.risk.level : null} /></dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Ledger check</dt><dd>{titleCase(r.verification.blockchain)}</dd></div>
          </dl>
        ) : <p className="text-sm text-slate-600">This code is not recognised.</p>}
      </Card>
      {r.journey.length > 0 && (
        <Card title="Journey">
          <ol className="list-decimal space-y-1 pl-5 text-sm">{r.journey.map((j, i) => <li key={`${j.step}-${i}`}>{titleCase(j.step)} by {titleCase(j.orgType)} - {formatDateTime(j.at)}</li>)}</ol>
        </Card>
      )}
      <p className="text-xs text-slate-500">Checked {formatDateTime(r.asOf)}</p>
    </div>
  );
}

export function QrVerificationPage() {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>();
  const check = useMutation({ mutationFn: (token: string) => api<Verification>(`/v1/public/verify/${encodeURIComponent(token)}`) });
  function submit() {
    const token = extractQrToken(input);
    if (!token) return setError('Paste the code or link printed on the package');
    setError(undefined);
    check.mutate(token);
  }
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="QR Verification" subtitle="Check a package QR code before you sell it" />
      <Card>
        <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <TextField label="QR code link or token" value={input} error={error} onChange={(e) => { setInput(e.target.value); setError(undefined); }} autoComplete="off" />
          {check.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage(check.error)}</p>}
          <Button type="submit" isLoading={check.isPending}>Verify</Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Each check is logged as a scan of that code.</p>
      </Card>
      {check.data && <Result r={check.data} />}
    </div>
  );
}
