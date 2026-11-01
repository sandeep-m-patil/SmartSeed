import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import type { AppNotification } from '../types';

/** Bell with unread count; silently hidden when the notifications service is not deployed yet. */
export function NotificationBell() {
  const api = useApi();
  const q = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<AppNotification[]>('/v1/notifications') });
  const unread = q.data?.filter((n) => !n.readAt).length ?? 0;
  if (q.error) return null;
  return (
    <Link to="/notifications" className="relative rounded-md p-2 text-slate-700 hover:bg-slate-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
      <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
