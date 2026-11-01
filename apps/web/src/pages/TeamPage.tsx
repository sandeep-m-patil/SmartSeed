import { useState } from 'react';
import { TENANT_ASSIGNABLE_ROLES, createUserSchema } from '@smartseed/shared';
import { useAction } from '../hooks/useAction';
import { useFormState } from '../hooks/useFormState';
import { usePagedList } from '../hooks/usePagedList';
import { useRoles } from '../hooks/useMe';
import { titleCase } from '../lib/format';
import { validate } from '../lib/validation';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { SelectField, TextField } from '../components/Field';
import { PageHeader, Toolbar } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { SearchBox, matchesSearch } from '../components/SearchBox';
import type { UserRow } from '../types';

const INITIAL = { fullName: '', email: '', password: '', role: 'manufacturer' };
const ROLE_OPTIONS = TENANT_ASSIGNABLE_ROLES.map((r) => ({ value: r, label: titleCase(r) }));

function CreateUserDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const form = useFormState(INITIAL);
  const create = useAction({
    run: (body: unknown, api) => api.send('/v1/users', { body }),
    success: 'Team member created',
    invalidate: ['users'],
    onDone: () => { form.reset(); onClose(); },
  });
  const submit = () => {
    const result = validate(createUserSchema, form.values);
    if (!result.ok) return form.setErrors(result.errors);
    create.mutate(result.data);
  };
  return (
    <Dialog open={open} title="Add team member" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={create.isPending}>Create user</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <TextField label="Full name" value={form.values.fullName} error={form.errors.fullName} onChange={(e) => form.set('fullName', e.target.value)} autoComplete="off" />
        <TextField label="Email" type="email" value={form.values.email} error={form.errors.email} onChange={(e) => form.set('email', e.target.value)} autoComplete="off" />
        <TextField label="Temporary password" type="password" value={form.values.password} error={form.errors.password} hint="At least 12 characters with upper-case, lower-case and a digit." onChange={(e) => form.set('password', e.target.value)} autoComplete="new-password" />
        <SelectField label="Role" value={form.values.role} error={form.errors.role} options={ROLE_OPTIONS} onChange={(e) => form.set('role', e.target.value)} />
        {create.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{create.errorText}</p>}
      </form>
    </Dialog>
  );
}

export function TeamPage() {
  const { can } = useRoles();
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const list = usePagedList<UserRow>({ queryKey: 'users', path: '/v1/users' });
  const rows = list.items.filter((u) => matchesSearch(search, u.fullName, u.email));
  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', cell: (u) => <span className="font-medium">{u.fullName}</span> },
    { key: 'email', header: 'Email', cell: (u) => u.email },
    { key: 'roles', header: 'Roles', cell: (u) => u.roles.map(titleCase).join(', '), isSecondary: true },
    { key: 'mfa', header: 'MFA', cell: (u) => <Badge tone={u.mfaEnabled ? 'success' : 'warning'}>{u.mfaEnabled ? 'On' : 'Off'}</Badge> },
  ];
  return (
    <div>
      <PageHeader title="Team" subtitle="People in your organization" actions={can('user:write') && <Button onClick={() => setIsCreating(true)}>Add team member</Button>} />
      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Name or email" /></Toolbar>
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={rows.length === 0} emptyMessage="No team members found." onRetry={list.refetch}>
        <DataTable caption="Team members" columns={columns} rows={rows} rowKey={(u) => u.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
      <CreateUserDialog open={isCreating} onClose={() => setIsCreating(false)} />
    </div>
  );
}
