import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createBatchSchema } from '@smartseed/shared';
import { useAction } from '../hooks/useAction';
import { useApi } from '../hooks/useApi';
import { useFormState } from '../hooks/useFormState';
import { usePagedList } from '../hooks/usePagedList';
import { useRoles } from '../hooks/useMe';
import { COUNT_FETCH_LIMIT } from '../lib/constants';
import { formatDate, formatNumber } from '../lib/format';
import { toOptionalNumber, validate } from '../lib/validation';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { SelectField, TextField } from '../components/Field';
import { PageHeader, Toolbar } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { SearchBox, matchesSearch } from '../components/SearchBox';
import { StatusBadge } from '../components/Badge';
import type { Batch, Product } from '../types';

const INITIAL = { productId: '', manufacturingDate: '', expiryDate: '', productionLocation: '', facility: '', initialQuantity: '', unit: 'packet' };
const UNIT_OPTIONS = [{ value: 'packet', label: 'Packets' }, { value: 'kg', label: 'Kilograms' }];

function CreateBatchDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const api = useApi();
  const form = useFormState(INITIAL);
  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.page<Product>(`/v1/products?limit=${COUNT_FETCH_LIMIT}`),
    enabled: open,
  });
  const create = useAction({
    run: (body: unknown, client) => client.send('/v1/batches', { body }),
    success: 'Batch created',
    invalidate: ['batches', 'snapshot'],
    onDone: () => { form.reset(); onClose(); },
  });
  const submit = () => {
    const result = validate(createBatchSchema, { ...form.values, initialQuantity: toOptionalNumber(form.values.initialQuantity) });
    if (!result.ok) return form.setErrors(result.errors);
    create.mutate(result.data);
  };
  const productOptions = (products.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.brand})` }));
  const v = form.values;
  const e = form.errors;
  return (
    <Dialog open={open} title="Create batch" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={create.isPending}>Create batch</Button></>}>
      <form className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); submit(); }} noValidate>
        <SelectField label="Product" value={v.productId} error={e.productId} options={productOptions} placeholder={products.isLoading ? 'Loading products...' : 'Select a product'} onChange={(ev) => form.set('productId', ev.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Manufacturing date" type="date" value={v.manufacturingDate} error={e.manufacturingDate} onChange={(ev) => form.set('manufacturingDate', ev.target.value)} />
          <TextField label="Expiry date" type="date" value={v.expiryDate} error={e.expiryDate} onChange={(ev) => form.set('expiryDate', ev.target.value)} />
        </div>
        <TextField label="Production location" value={v.productionLocation} error={e.productionLocation} onChange={(ev) => form.set('productionLocation', ev.target.value)} />
        <TextField label="Facility" value={v.facility} error={e.facility} onChange={(ev) => form.set('facility', ev.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Quantity" inputMode="numeric" value={v.initialQuantity} error={e.initialQuantity} onChange={(ev) => form.set('initialQuantity', ev.target.value)} />
          <SelectField label="Unit" value={v.unit} error={e.unit} options={UNIT_OPTIONS} onChange={(ev) => form.set('unit', ev.target.value)} />
        </div>
        {create.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{create.errorText}</p>}
      </form>
    </Dialog>
  );
}

export function BatchesPage() {
  const { can } = useRoles();
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const list = usePagedList<Batch>({ queryKey: 'batches', path: '/v1/batches' });
  const rows = list.items.filter((b) => matchesSearch(search, b.batchCode, b.productName, b.brand, b.facility));
  const columns: Column<Batch>[] = [
    { key: 'code', header: 'Batch', cell: (b) => <Link to={`/batches/${b.id}`} className="font-medium text-brand-700 underline">{b.batchCode}</Link> },
    { key: 'product', header: 'Product', cell: (b) => b.productName ?? '-' },
    { key: 'qty', header: 'Quantity', cell: (b) => `${formatNumber(b.initialQuantity)} ${b.unit}` },
    { key: 'expiry', header: 'Expiry', cell: (b) => formatDate(b.expiryDate), isSecondary: true },
    { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.expired ? 'expired' : b.status} /> },
  ];
  return (
    <div>
      <PageHeader title="Batches" subtitle="Seed batches, passports and QR codes" actions={can('batch:create') && <Button onClick={() => setIsCreating(true)}>Create batch</Button>} />
      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Batch code, product, facility" /></Toolbar>
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={rows.length === 0} emptyMessage="No batches yet." onRetry={list.refetch}>
        <DataTable caption="Batches" columns={columns} rows={rows} rowKey={(b) => b.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
      <CreateBatchDialog open={isCreating} onClose={() => setIsCreating(false)} />
    </div>
  );
}
