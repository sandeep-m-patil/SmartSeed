import { useQuery } from '@tanstack/react-query';
import { hasPermission, type Permission, type Role } from '@smartseed/shared';
import type { Me } from '../types';
import { useApi } from './useApi';

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/v1/auth/me'), staleTime: Infinity });
}

/** Roles of the signed-in user plus a permission check bound to them. */
export function useRoles(): { roles: Role[]; can: (p: Permission) => boolean; isLoading: boolean } {
  const me = useMe();
  const roles = me.data?.roles ?? [];
  return { roles, can: (p) => hasPermission(roles, p), isLoading: me.isLoading };
}
