import { useQuery } from '@tanstack/react-query';
import { createTransferSchema } from '@smartseed/shared';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { useFormState } from '../../hooks/useFormState';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { idempotencyHeader } from '../../lib/idempotency';
import { blankToUndefined, toOptionalNumber, validate } from '../../lib/validation';
import { titleCase } from '../../lib/format';
import type { InventoryRow, Org } from '../../types';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { SelectField, TextAreaField, TextField } from '../Field';

const INITIAL = { batchId: '', toOrgId: '', quantity: '', note: '' };

/** Creates a transfer. The Idempotency-Key is stable across retries of the same attempt and rotated after success. */
export function CreateTransferDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const api = useApi();
  const form = useFormState(INITIAL);
  const key = useIdempotencyKey();
  const inventory = useQuery({ queryKey: ['inventory'], queryFn: () => api.get<InventoryRow[]>('/v1/inventory'), enabled: open });
  const orgs = useQuery({ queryKey: ['organizations', ''], queryFn: () => api.get<Org[]>('/v1/organizations'), enabled: open });

  const create = useAction({
    run: (body: unknown, client) => client.send<{ id: string }>('/v1/transfers', { body, headers: idempotencyHeader(key.current()) }),
    success: (r) => (r.meta.replayed ? 'This transfer was already created - showing the existing one' : 'Transfer created'),
    invalidate: ['transfers', 'inventory', 'snapshot'],
    onDone: () => { key.rotate(); form.reset(); onClose(); },
  });

  const stock = (inventory.data ?? []).filter((r) => r.available > 0 && !r.expired && r.batchStatus === 'active');
  const selected = stock.find((r) => r.batchId === form.values.batchId);
  const submit = () => {
    const result = validate(createTransferSchema, { ...form.values, quantity: toOptionalNumber(form.values.quantity), note: blankToUndefined(form.values.note) });
    if (!result.ok) return form.setErrors(result.errors);
    if (selected && result.data.quantity > selected.available) return form.setErrors({ quantity: `Only ${selected.available} units are available` });
    create.mutate(result.data);
  };
  const edit = (name: keyof typeof INITIAL, value: string) => { form.set(name, value); key.rotate(); };

  return (
    <Dialog open={open} title="Create transfer" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={create.isPending}>Create transfer</Button></>}>
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <SelectField label="Batch" value={form.values.batchId} error={form.errors.batchId} placeholder={inventory.isLoading ? 'Loading stock...' : 'Select a batch'}
          options={stock.map((r) => ({ value: r.batchId, label: `${r.batchCode} - ${r.productName} (${r.available} available)` }))} onChange={(e) => edit('batchId', e.target.value)} />
        <SelectField label="Recipient" value={form.values.toOrgId} error={form.errors.toOrgId} placeholder={orgs.isLoading ? 'Loading organizations...' : 'Select an organization'}
          options={(orgs.data ?? []).filter((o) => o.status === 'active').map((o) => ({ value: o.id, label: `${o.legalName} (${titleCase(o.type)})` }))} onChange={(e) => edit('toOrgId', e.target.value)} />
        <TextField label="Quantity" inputMode="numeric" value={form.values.quantity} error={form.errors.quantity} {...(selected ? { hint: `Up to ${selected.available} available` } : {})} onChange={(e) => edit('quantity', e.target.value)} />
        <TextAreaField label="Note (optional)" value={form.values.note} error={form.errors.note} onChange={(e) => edit('note', e.target.value)} />
        {(inventory.error || orgs.error) && <p role="alert" className="text-sm text-red-700">Could not load stock or organizations.</p>}
        {create.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{create.errorText}</p>}
      </form>
    </Dialog>
  );
}
