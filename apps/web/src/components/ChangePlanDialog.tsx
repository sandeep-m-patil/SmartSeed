import { useEffect, useState } from 'react';
import { usePlans, formatPrice } from '../pages/BillingPage';
import { useAction } from '../hooks/useAction';
import type { Tenant } from '../types';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { SelectField } from './Field';

const STATUSES = ['trialing', 'active', 'past_due', 'cancelled'].map((s) => ({ value: s, label: s.replace('_', ' ') }));

/** Changes a tenant's subscription plan/status (PUT /v1/platform/tenants/:id/subscription). Prices come from the API. */
export function ChangePlanDialog({ tenant, onClose }: { tenant: Tenant | null; onClose(): void }) {
  const plans = usePlans();
  const [planCode, setPlanCode] = useState('');
  const [status, setStatus] = useState('active');
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { if (tenant) { setPlanCode(''); setStatus('active'); setError(undefined); } }, [tenant]);
  const change = useAction({
    run: (body: unknown, api) => api.send(`/v1/platform/tenants/${tenant?.id}/subscription`, { method: 'PUT', body }),
    success: 'Subscription updated',
    invalidate: ['subscription', 'usage'],
    onDone: onClose,
  });
  const submit = () => {
    if (!planCode) return setError('Choose a plan');
    change.mutate({ planCode, status });
  };
  const options = (plans.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.code, label: `${p.name} - ${formatPrice(p.priceMinor, p.currency)}/${p.billingInterval}` }));
  return (
    <Dialog open={tenant !== null} title={`Change plan - ${tenant?.name ?? ''}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={change.isPending}>Update plan</Button></>}>
      <div className="space-y-3">
        <SelectField label="Plan" value={planCode} error={error} options={options} placeholder={plans.isLoading ? 'Loading plans...' : 'Select a plan'} onChange={(e) => { setPlanCode(e.target.value); setError(undefined); }} />
        <SelectField label="Subscription status" value={status} options={STATUSES} onChange={(e) => setStatus(e.target.value)} />
        {plans.error && <p role="alert" className="text-sm text-red-700">Could not load plans.</p>}
        {change.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{change.errorText}</p>}
      </div>
    </Dialog>
  );
}
