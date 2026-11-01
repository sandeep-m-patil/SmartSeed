import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAction } from '../hooks/useAction';
import { useApi } from '../hooks/useApi';
import { useFormState } from '../hooks/useFormState';
import { formatNumber } from '../lib/format';
import { toOptionalNumber } from '../lib/validation';
import type { Plan } from '../types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { TextField } from '../components/Field';
import { PageHeader } from '../components/Layout';
import { QueryState } from '../components/QueryState';

const LIMIT_KEYS = ['batches', 'users', 'scans', 'investigations'] as const;
const INITIAL = { code: '', name: '', priceMinor: '', currency: '', billingInterval: '', gatewayPlanId: '', batches: '', users: '', scans: '', investigations: '' };
const CODE_PATTERN = /^[a-z0-9_-]{2,40}$/;

/** Price exactly as the API supplies it (minor units + currency); nothing is hardcoded. */
export function formatPrice(priceMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(priceMinor / 100);
  } catch {
    return `${priceMinor} ${currency} (minor units)`;
  }
}

function validateForm(v: typeof INITIAL): Record<string, string> {
  const e: Record<string, string> = {};
  if (!CODE_PATTERN.test(v.code)) e.code = 'Use 2-40 lowercase letters, digits, - or _';
  if (v.name.trim().length < 2) e.name = 'Enter a name';
  const price = toOptionalNumber(v.priceMinor);
  if (price === undefined || !Number.isInteger(price) || price < 0) e.priceMinor = 'Enter a whole number of minor units (0 or more)';
  if (v.currency.trim().length !== 3) e.currency = 'Use a 3-letter currency code';
  for (const k of LIMIT_KEYS) {
    const n = toOptionalNumber(v[k]);
    if (n !== undefined && (!Number.isInteger(n) || n < 0)) e[k] = 'Whole number, 0 or more (blank = unlimited)';
  }
  return e;
}

function CreatePlanDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const form = useFormState(INITIAL);
  const create = useAction({
    run: (body: unknown, api) => api.send('/v1/platform/plans', { body }),
    success: 'Plan saved',
    invalidate: ['plans'],
    onDone: () => { form.reset(); onClose(); },
  });
  const submit = () => {
    const errors = validateForm(form.values);
    if (Object.keys(errors).length) return form.setErrors(errors);
    const v = form.values;
    const limits: Record<string, number> = {};
    for (const k of LIMIT_KEYS) { const n = toOptionalNumber(v[k]); if (n !== undefined) limits[k] = n; }
    create.mutate({
      code: v.code, name: v.name.trim(), limits, priceMinor: Number(v.priceMinor), currency: v.currency.trim().toUpperCase(),
      ...(v.billingInterval.trim() ? { billingInterval: v.billingInterval.trim() } : {}), ...(v.gatewayPlanId.trim() ? { gatewayPlanId: v.gatewayPlanId.trim() } : {}),
    });
  };
  const f = (name: keyof typeof INITIAL, label: string, hint?: string) => (
    <TextField label={label} value={form.values[name]} error={form.errors[name]} onChange={(e) => form.set(name, e.target.value)} autoComplete="off" {...(hint ? { hint } : {})} />
  );
  return (
    <Dialog open={open} title="Create or update plan" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={create.isPending}>Save plan</Button></>}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {f('code', 'Code', 'An existing code updates that plan')}{f('name', 'Name')}
        {f('priceMinor', 'Price (minor units)', 'e.g. cents or paise')}{f('currency', 'Currency (ISO code)')}
        {f('billingInterval', 'Billing interval (optional)')}{f('gatewayPlanId', 'Gateway plan id (optional)')}
        <div className="grid gap-3 sm:grid-cols-2">{LIMIT_KEYS.map((k) => f(k, `Limit: ${k}`))}</div>
        {create.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{create.errorText}</p>}
      </form>
    </Dialog>
  );
}

export function usePlans() {
  const api = useApi();
  return useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/v1/platform/plans') });
}

export function BillingPage() {
  const [isCreating, setIsCreating] = useState(false);
  const q = usePlans();
  const columns: Column<Plan>[] = [
    { key: 'name', header: 'Plan', cell: (p) => <><span className="font-medium">{p.name}</span><span className="block text-xs text-slate-500">{p.code}</span></> },
    { key: 'price', header: 'Price', cell: (p) => `${formatPrice(p.priceMinor, p.currency)} / ${p.billingInterval}` },
    { key: 'limits', header: 'Limits', cell: (p) => LIMIT_KEYS.map((k) => `${k}: ${p.limits[k] == null ? 'unlimited' : formatNumber(p.limits[k])}`).join(', '), isSecondary: true },
    { key: 'active', header: 'Status', cell: (p) => <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</Badge> },
  ];
  return (
    <div>
      <PageHeader title="Billing" subtitle="Subscription plans. Assign a plan to a tenant from Organizations." actions={<Button onClick={() => setIsCreating(true)}>Create plan</Button>} />
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} emptyMessage="No plans defined." onRetry={() => void q.refetch()}>
        <DataTable caption="Plans" columns={columns} rows={q.data ?? []} rowKey={(p) => p.code} />
      </QueryState>
      <CreatePlanDialog open={isCreating} onClose={() => setIsCreating(false)} />
    </div>
  );
}
