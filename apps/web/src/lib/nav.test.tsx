import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@smartseed/shared';
import { describe, expect, it } from 'vitest';
import { NavList } from '../components/NavList';
import { canAccessNav, navItemsFor } from './nav';

const labels = (roles: Role[]) => navItemsFor(roles).map((i) => i.label);

describe('navItemsFor', () => {
  it('platform admin', () => {
    expect(labels(['platform_admin'])).toEqual(['Overview', 'Organizations', 'Risk Management', 'Investigations', 'Billing', 'Settings']);
  });

  it('company admin', () => {
    expect(labels(['company_admin'])).toEqual([
      'Dashboard', 'Team', 'Partners', 'Products', 'Batches', 'QR Management', 'Transfers', 'Risk Alerts', 'Investigations', 'Subscription',
    ]);
  });

  it('manufacturer', () => {
    expect(labels(['manufacturer'])).toEqual(['Dashboard', 'Products', 'Batches', 'Inventory', 'Shipments', 'Risk Alerts']);
  });

  it.each(['distributor', 'wholesaler'] as Role[])('%s', (role) => {
    expect(labels([role])).toEqual(['Dashboard', 'Incoming Batches', 'Inventory', 'Transfers', 'Verification']);
  });

  it('retailer', () => {
    expect(labels(['retailer'])).toEqual(['Dashboard', 'Received Batches', 'Inventory', 'Sales', 'QR Verification', 'Reports']);
  });

  it('gives an auditor (no permissions) nothing, and nobody sees entries outside their permissions', () => {
    expect(labels(['auditor'])).toEqual([]);
    expect(labels([])).toEqual([]);
    expect(labels(['retailer'])).not.toContain('Batches');
    expect(labels(['manufacturer'])).not.toContain('Team');
  });

  it('canAccessNav mirrors visibility', () => {
    expect(canAccessNav(['retailer'], 'sales')).toBe(true);
    expect(canAccessNav(['manufacturer'], 'sales')).toBe(false);
    expect(canAccessNav(['company_admin'], 'organizations')).toBe(false);
  });
});

describe('NavList', () => {
  it('renders links only for permitted entries', () => {
    render(<MemoryRouter><NavList roles={['retailer']} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Batches' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull();
  });
});
