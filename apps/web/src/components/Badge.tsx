import type { ReactNode } from 'react';
import { titleCase } from '../lib/format';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  info: 'bg-blue-50 text-blue-800 ring-blue-600/30',
  success: 'bg-green-50 text-green-800 ring-green-600/30',
  warning: 'bg-yellow-50 text-yellow-900 ring-yellow-600/40',
  danger: 'bg-red-50 text-red-900 ring-red-600/40',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  active: 'success', received: 'success', resolved: 'success', committed: 'success', open: 'warning', pending: 'warning',
  created: 'neutral', dispatched: 'info', in_transit: 'info', investigating: 'info', under_investigation: 'info', trialing: 'info',
  suspended: 'danger', rejected: 'danger', cancelled: 'neutral', revoked: 'danger', superseded: 'warning', expired: 'danger',
  failed: 'danger', recalled: 'danger', held: 'warning', dismissed: 'neutral',
};

/** Textual status pill (the label is always shown, colour only reinforces it). */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{titleCase(status)}</Badge>;
}
