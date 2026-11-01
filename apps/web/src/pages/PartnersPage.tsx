import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createOrganizationSchema } from '@smartseed/shared';
import { useAction } from '../hooks/useAction';
import { useApi } from '../hooks/useApi';
import { useFormState } from '../hooks/useFormState';
import { useRoles } from '../hooks/useMe';
import { titleCase } from '../lib/format';
import { validate } from '../lib/validation';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { SelectField, TextField } from '../components/Field';
import { PageHeader, Toolbar } from '../components/Layout';
import { QueryState } from '../components/QueryState';
import { SearchBox, matchesSearch } from '../components/SearchBox';
import { StatusBadge } from '../components/Badge';
import type { Org } from '../types';

const INITIAL = { type: 'distributor', legalName: '', registrationNo: '', adminName: '', adminEmail: '', adminPassword: '' };
const TYPE_OPTIONS = ['distributor', 'wholesaler', 'retailer'].map((t) => ({ value: t, label: titleCase(t) }));

function CreatePartnerDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const form = useFormState(INITIAL);
  const create = useAction({
    run: (body: unknown, api) => api.send('/v1/organizations', { body }),
    success: 'Partner organization created',
    invalidate: ['organizations'],
    onDone: () => { form.reset(); onClose(); },
  });
  const submit = () => {
    const result = validate(createOrganizationSchema, form.values);
    if (!result.ok) return form.setErrors(result.errors);
    create.mutate(result.data);
  };
  const text = (name: keyof typeof INITIAL, label: string, extra: { type?: string; hint?: string; autoComplete?: string } = {}) => (
    <TextField label={label} value={form.values[name]} error={form.errors[name]} onChange={(e) => form.set(name, e.target.value)} autoComplete={extra.autoComplete ?? 'off'} {...(extra.type ? { type: extra.type } : {})} {...(extra.hint ? { hint: extra.hint } : {})} />
  );
  return (
    <Dialog open={open} title="Create partner organization" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={create.isPending}>Create partner</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <SelectField label="Type" value={form.values.type} error={form.errors.type} options={TYPE_OPTIONS} onChange={(e) => form.set('type', e.target.value)} />
        {text('legalName', 'Legal name')}
        {text('registrationNo', 'Registration number')}
        {text('adminName', 'Administrator name')}
        {text('adminEmail', 'Administrator email', { type: 'email' })}
        {text('adminPassword', 'Temporary password', { type: 'password', autoComplete: 'new-password', hint: 'At least 12 characters with upper-case, lower-case and a digit.' })}
        {create.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{create.errorText}</p>}
      </form>
    </Dialog>
  );
}

export function PartnersPage() {
  const api = useApi();
  const { can } = useRoles();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const q = useQuery({ queryKey: ['organizations', type], queryFn: () => api.get<Org[]>(`/v1/organizations${type ? `?type=${type}` : ''}`) });
  const rows = (q.data ?? []).filter((o) => matchesSearch(search, o.legalName, o.registrationNo));
  const columns: Column<Org>[] = [
    { key: 'name', header: 'Legal name', cell: (o) => <span className="font-medium">{o.legalName}</span> },
    { key: 'type', header: 'Type', cell: (o) => titleCase(o.type) },
    { key: 'reg', header: 'Registration no.', cell: (o) => o.registrationNo, isSecondary: true },
    { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
  ];
  return (
    <div>
      <PageHeader title="Partners" subtitle="Distributors, wholesalers and retailers linked to your company" actions={can('org:write') && <Button onClick={() => setIsCreating(true)}>Create partner</Button>} />
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Name or registration no." />
        <div className="w-48"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={TYPE_OPTIONS} placeholder="All types" /></div>
      </Toolbar>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={rows.length === 0} emptyMessage="No partner organizations yet." onRetry={() => void q.refetch()}>
        <DataTable caption="Partner organizations" columns={columns} rows={rows} rowKey={(o) => o.id} />
      </QueryState>
      <CreatePartnerDialog open={isCreating} onClose={() => setIsCreating(false)} />
    </div>
  );
}
