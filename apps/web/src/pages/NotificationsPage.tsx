import { useQuery } from '@tanstack/react-query';
import { useAction } from '../hooks/useAction';
import { useApi } from '../hooks/useApi';
import { formatDateTime, titleCase } from '../lib/format';
import type { AppNotification, NotificationPref } from '../types';
import { Button } from '../components/Button';
import { Card, PageHeader } from '../components/Layout';
import { QueryState } from '../components/QueryState';

function Preferences() {
  const api = useApi();
  const q = useQuery({ queryKey: ['notification-preferences'], queryFn: () => api.get<NotificationPref[]>('/v1/notification-preferences') });
  const save = useAction<NotificationPref[]>({
    run: (prefs, client) => client.send('/v1/notification-preferences', { method: 'PUT', body: prefs }),
    success: 'Notification preferences saved',
    invalidate: ['notification-preferences'],
  });
  const toggle = (p: NotificationPref) =>
    save.mutate((q.data ?? []).map((x) => (x.type === p.type && x.channel === p.channel ? { ...x, enabled: !x.enabled } : x)));
  return (
    <Card title="Preferences">
      <QueryState isLoading={q.isLoading} error={q.error} isOptionalEndpoint isEmpty={q.data?.length === 0} emptyMessage="No preferences to configure." onRetry={() => void q.refetch()}>
        <ul className="divide-y divide-slate-100">
          {(q.data ?? []).map((p) => (
            <li key={`${p.type}-${p.channel}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{titleCase(p.type)} via {titleCase(p.channel)}</span>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={p.enabled} disabled={save.isPending} onChange={() => toggle(p)} className="h-4 w-4 accent-brand-600" />
                <span className="sr-only">{`${titleCase(p.type)} via ${titleCase(p.channel)}`}</span>{p.enabled ? 'On' : 'Off'}
              </label>
            </li>
          ))}
        </ul>
        {save.errorText && <p role="alert" className="mt-2 text-sm text-red-700">{save.errorText}</p>}
      </QueryState>
    </Card>
  );
}

export function NotificationsPage() {
  const api = useApi();
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api.get<AppNotification[]>('/v1/notifications') });
  const read = useAction<string>({ run: (id, client) => client.send(`/v1/notifications/${id}/read`, { body: {} }), success: 'Marked as read', invalidate: ['notifications'] });
  return (
    <div className="space-y-4">
      <PageHeader title="Notifications" />
      <QueryState isLoading={q.isLoading} error={q.error} isOptionalEndpoint isEmpty={q.data?.length === 0} emptyMessage="You have no notifications." onRetry={() => void q.refetch()}>
        <ul className="space-y-2">
          {(q.data ?? []).map((n) => (
            <li key={n.id} className={`flex items-start justify-between gap-3 rounded-md border p-3 text-sm ${n.readAt ? 'border-slate-200 bg-white' : 'border-brand-600/40 bg-green-50'}`}>
              <div>
                <p className="font-medium">{n.title ?? titleCase(n.type)}{!n.readAt && <span className="ml-2 text-xs font-semibold text-brand-700">New</span>}</p>
                {(n.message ?? n.body) && <p className="text-slate-700">{n.message ?? n.body}</p>}
                <p className="text-xs text-slate-500">{formatDateTime(n.createdAt ?? n.created_at)}</p>
              </div>
              {!n.readAt && <Button size="sm" variant="secondary" isLoading={read.isPending && read.variables === n.id} onClick={() => read.mutate(n.id)}>Mark read</Button>}
            </li>
          ))}
        </ul>
      </QueryState>
      <Preferences />
    </div>
  );
}
