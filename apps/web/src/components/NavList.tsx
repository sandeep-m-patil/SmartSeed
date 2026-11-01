import { NavLink } from 'react-router-dom';
import type { Role } from '@smartseed/shared';
import { navItemsFor } from '../lib/nav';

/** Role-based navigation: renders only entries the user's roles/permissions allow. */
export function NavList({ roles, onNavigate }: { roles: readonly Role[]; onNavigate?: () => void }) {
  const items = navItemsFor(roles);
  return (
    <nav aria-label="Main">
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
