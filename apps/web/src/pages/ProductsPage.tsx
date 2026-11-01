import { useState } from 'react';
import { createProductSchema } from '@smartseed/shared';
import { useAction } from '../hooks/useAction';
import { useFormState } from '../hooks/useFormState';
import { usePagedList } from '../hooks/usePagedList';
import { useRoles } from '../hooks/useMe';
import { formatDate } from '../lib/format';
import { validate } from '../lib/validation';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { TextAreaField, TextField } from '../components/Field';
import { PageHeader, Toolbar } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { SearchBox, matchesSearch } from '../components/SearchBox';
import type { Product } from '../types';

const INITIAL = { name: '', brand: '', cropType: '', variety: '', category: '', description: '' };
type FieldName = keyof typeof INITIAL;
const FIELDS: { name: FieldName; label: string }[] = [
  { name: 'name', label: 'Product name' }, { name: 'brand', label: 'Brand' }, { name: 'cropType', label: 'Crop type' },
  { name: 'variety', label: 'Variety' }, { name: 'category', label: 'Category' },
];

function CreateProductDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const form = useFormState(INITIAL);
  const create = useAction({
    run: (body: unknown, api) => api.send('/v1/products', { body }),
    success: 'Product created',
    invalidate: ['products', 'snapshot'],
    onDone: () => { form.reset(); onClose(); },
  });
  const submit = () => {
    const result = validate(createProductSchema, form.values);
    if (!result.ok) return form.setErrors(result.errors);
    create.mutate(result.data);
  };
  return (
    <Dialog open={open} title="New product" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={create.isPending}>Create product</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {FIELDS.map((f) => <TextField key={f.name} label={f.label} value={form.values[f.name]} error={form.errors[f.name]} onChange={(e) => form.set(f.name, e.target.value)} />)}
        <TextAreaField label="Description (optional)" value={form.values.description} error={form.errors.description} onChange={(e) => form.set('description', e.target.value)} />
        {create.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{create.errorText}</p>}
      </form>
    </Dialog>
  );
}

export function ProductsPage() {
  const { can } = useRoles();
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const list = usePagedList<Product>({ queryKey: 'products', path: '/v1/products' });
  const rows = list.items.filter((p) => matchesSearch(search, p.name, p.brand, p.cropType, p.variety, p.category));
  const columns: Column<Product>[] = [
    { key: 'name', header: 'Product', cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'brand', header: 'Brand', cell: (p) => p.brand },
    { key: 'crop', header: 'Crop / variety', cell: (p) => `${p.cropType} / ${p.variety}`, isSecondary: true },
    { key: 'cat', header: 'Category', cell: (p) => p.category, isSecondary: true },
    { key: 'created', header: 'Created', cell: (p) => formatDate(p.createdAt), isSecondary: true },
  ];
  return (
    <div>
      <PageHeader title="Products" subtitle="Seed products in your catalogue" actions={can('product:write') && <Button onClick={() => setIsCreating(true)}>New product</Button>} />
      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Name, brand, crop" /></Toolbar>
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={rows.length === 0} emptyMessage="No products yet." onRetry={list.refetch}>
        <DataTable caption="Products" columns={columns} rows={rows} rowKey={(p) => p.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
      <CreateProductDialog open={isCreating} onClose={() => setIsCreating(false)} />
    </div>
  );
}
