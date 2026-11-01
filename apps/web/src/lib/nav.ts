import { hasPermission, type Permission, type Role } from '@smartseed/shared';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  /** Permission the user must hold (checked with hasPermission over all of their roles). */
  permission?: Permission;
  /** Roles this entry is designed for; a permission alone is not enough (e.g. retailers hold transfer:read but use "Received Batches"). */
  audience: readonly Role[];
}

const ORG_ROLES: readonly Role[] = ['company_admin', 'manufacturer', 'distributor', 'wholesaler', 'retailer'];
const TRANSFER_PARTNER_ROLES: readonly Role[] = ['distributor', 'wholesaler'];

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', path: '/', audience: ['platform_admin'] },
  { id: 'dashboard', label: 'Dashboard', path: '/', audience: ORG_ROLES },
  { id: 'organizations', label: 'Organizations', path: '/organizations', permission: 'platform:tenant:read', audience: ['platform_admin'] },
  { id: 'risk-management', label: 'Risk Management', path: '/risk-management', permission: 'platform:risk:read', audience: ['platform_admin'] },
  { id: 'team', label: 'Team', path: '/team', permission: 'user:read', audience: ['company_admin'] },
  { id: 'partners', label: 'Partners', path: '/partners', permission: 'org:write', audience: ['company_admin'] },
  { id: 'products', label: 'Products', path: '/products', permission: 'product:read', audience: ['company_admin', 'manufacturer'] },
  { id: 'batches', label: 'Batches', path: '/batches', permission: 'batch:read', audience: ['company_admin', 'manufacturer'] },
  { id: 'qr', label: 'QR Management', path: '/qr', permission: 'qr:read', audience: ['company_admin'] },
  { id: 'incoming', label: 'Incoming Batches', path: '/incoming', permission: 'transfer:receive', audience: TRANSFER_PARTNER_ROLES },
  { id: 'received', label: 'Received Batches', path: '/received', permission: 'transfer:receive', audience: ['retailer'] },
  { id: 'inventory', label: 'Inventory', path: '/inventory', permission: 'inventory:read', audience: ['manufacturer', ...TRANSFER_PARTNER_ROLES, 'retailer'] },
  { id: 'shipments', label: 'Shipments', path: '/transfers', permission: 'transfer:read', audience: ['manufacturer'] },
  { id: 'transfers', label: 'Transfers', path: '/transfers', permission: 'transfer:read', audience: ['company_admin', ...TRANSFER_PARTNER_ROLES] },
  { id: 'verification', label: 'Verification', path: '/verification', permission: 'batch:read', audience: TRANSFER_PARTNER_ROLES },
  { id: 'sales', label: 'Sales', path: '/sales', permission: 'sale:record', audience: ['retailer'] },
  { id: 'qr-verification', label: 'QR Verification', path: '/qr-verification', permission: 'batch:read', audience: ['retailer'] },
  { id: 'reports', label: 'Reports', path: '/reports', permission: 'inventory:read', audience: ['retailer'] },
  { id: 'alerts', label: 'Risk Alerts', path: '/alerts', permission: 'alert:read', audience: ['company_admin', 'manufacturer'] },
  { id: 'investigations', label: 'Investigations', path: '/investigations', permission: 'investigation:read', audience: ['platform_admin', 'company_admin'] },
  { id: 'subscription', label: 'Subscription', path: '/subscription', permission: 'billing:read', audience: ['company_admin'] },
  { id: 'billing', label: 'Billing', path: '/billing', permission: 'platform:billing:manage', audience: ['platform_admin'] },
  { id: 'settings', label: 'Settings', path: '/settings', permission: 'platform:audit:read', audience: ['platform_admin'] },
];

const isVisible = (item: NavItem, roles: readonly Role[]): boolean =>
  roles.some((r) => item.audience.includes(r)) && (!item.permission || hasPermission(roles, item.permission));

/** Navigation entries a user may see, in display order. */
export function navItemsFor(roles: readonly Role[]): NavItem[] {
  const seen = new Set<string>();
  return NAV_ITEMS.filter((item) => {
    if (!isVisible(item, roles)) return false;
    const key = `${item.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function canAccessNav(roles: readonly Role[], id: string): boolean {
  return NAV_ITEMS.some((item) => item.id === id && isVisible(item, roles));
}

/** True when any of the named nav entries is visible (used by routes shared between several entries). */
export const canAccessAny = (roles: readonly Role[], ids: readonly string[]): boolean => ids.some((id) => canAccessNav(roles, id));
