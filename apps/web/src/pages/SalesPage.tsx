import { useQuery } from '@tanstack/react-query';
import { recordSaleSchema } from '@smartseed/shared';
import { useAction } from '../hooks/useAction';
import { useApi } from '../hooks/useApi';
import { useFormState } from '../hooks/useFormState';
import { useIdempotencyKey } from '../hooks/useIdempotencyKey';
import { idempotencyHeader } from '../lib/idempotency';
import { formatNumber } from '../lib/format';
import { toOptionalNumber, validate } from '../lib/validation';
import type { InventoryRow, SaleResult } from '../types';
import { Button } from '../components/Button';
import { SelectField, TextField } from '../components/Field';
import { Card, PageHeader } from '../components/Layout';

export function SalesPage() {
  const api = useApi();
  const form = useFormState({ batchId: '', quantity: '' });
  const key = useIdempotencyKey();
  const inventory = useQuery({ queryKey: ['inventory'], queryFn: () => api.get<InventoryRow[]>('/v1/inventory') });
  const sellable = (inventory.data ?? []).filter((r) => r.available > 0 && !r.expired && r.batchStatus === 'active');
  const selected = sellable.find((r) => r.batchId === form.values.batchId);

  const sale = useAction({
    run: (body: unknown, client) => client.send<SaleResult>('/v1/sales', { body, headers: idempotencyHeader(key.current()) }),
    success: (r) => (r.data.replayed ? 'This sale was already recorded' : `Sale recorded: ${r.data.sold} units sold, ${r.data.remaining} remaining`),
    invalidate: ['inventory', 'inventory-movements', 'snapshot'],
    onDone: () => { key.rotate(); form.reset(); },
  });
  const submit = () => {
    const result = validate(recordSaleSchema, { batchId: form.values.batchId, quantity: toOptionalNumber(form.values.quantity) });
    if (!result.ok) return form.setErrors(result.errors);
    if (selected && result.data.quantity > selected.available) return form.setErrors({ quantity: `Only ${selected.available} units are available` });
    sale.mutate(result.data);
  };

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Sales" subtitle="Record a retail sale; stock is deducted from the selected batch" />
      <Card>
        <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <SelectField label="Batch" value={form.values.batchId} error={form.errors.batchId} placeholder={inventory.isLoading ? 'Loading stock...' : 'Select a batch'}
            options={sellable.map((r) => ({ value: r.batchId, label: `${r.batchCode} - ${r.productName} (${formatNumber(r.available)} available)` }))}
            onChange={(e) => { form.set('batchId', e.target.value); key.rotate(); }} />
          <TextField label="Quantity sold" inputMode="numeric" value={form.values.quantity} error={form.errors.quantity} {...(selected ? { hint: `Up to ${selected.available} available` } : {})}
            onChange={(e) => { form.set('quantity', e.target.value); key.rotate(); }} />
          {inventory.error && <p role="alert" className="text-sm text-red-700">Could not load your stock.</p>}
          {sale.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{sale.errorText}</p>}
          <Button type="submit" isLoading={sale.isPending}>Record sale</Button>
        </form>
      </Card>
    </div>
  );
}
