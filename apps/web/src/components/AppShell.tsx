import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth';
import { useMe } from '../hooks/useMe';
import { useEventStream } from '../hooks/useEventStream';
import { NavList } from './NavList';
import { NotificationBell } from './NotificationBell';
import { Button } from './Button';
import { QueryState } from './QueryState';
import { titleCase } from '../lib/format';

/** Authenticated frame: skip link, responsive sidebar (drawer on phones), top bar, live event stream. */
export function AppShell({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const me = useMe();
  const [isOpen, setIsOpen] = useState(false);
  const roles = me.data?.roles ?? [];
  useEventStream(Boolean(me.data));

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <button type="button" className="rounded-md p-2 hover:bg-slate-100 lg:hidden" aria-label="Toggle navigation" aria-expanded={isOpen} aria-controls="sidebar" onClick={() => setIsOpen((o) => !o)}>
            <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <span className="text-lg font-semibold text-brand-700">SmartSeed</span>
        </div>
        <div className="flex items-center gap-2">
          {me.data && <span className="hidden text-sm text-slate-600 sm:inline">{me.data.fullName} &middot; {roles.map(titleCase).join(', ')}{me.data.orgName ? ` - ${me.data.orgName}` : ''}</span>}
          <NotificationBell />
          <Button variant="secondary" size="sm" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl">
        <aside id="sidebar" className={`${isOpen ? 'block' : 'hidden'} fixed inset-x-0 top-[49px] z-20 max-h-[calc(100vh-49px)] overflow-y-auto border-b border-slate-200 bg-white p-3 shadow-md lg:static lg:block lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r lg:shadow-none`}>
          <NavList roles={roles} onNavigate={() => setIsOpen(false)} />
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 lg:px-6">
          <QueryState isLoading={me.isLoading} error={me.error} onRetry={() => void me.refetch()}>{children}</QueryState>
        </main>
      </div>
    </div>
  );
}
