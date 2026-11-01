import type { ReactNode } from 'react';
import type { Permission } from '@smartseed/shared';
import { useRoles } from '../hooks/useMe';
import { canAccessAny } from '../lib/nav';

interface Props {
  /** Allowed when any of these nav entries is visible for the user's roles. */
  ids?: string[];
  /** Or when the user holds this permission (for routes without a nav entry, e.g. notifications). */
  permission?: Permission;
  children: ReactNode;
}

export function RequireAccess({ ids = [], permission, children }: Props) {
  const { roles, can } = useRoles();
  const isAllowed = canAccessAny(roles, ids) || (permission !== undefined && can(permission));
  if (!isAllowed) {
    return (
      <div role="alert" className="rounded-md border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="mt-1 text-sm text-slate-600">Your role does not have access to this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
