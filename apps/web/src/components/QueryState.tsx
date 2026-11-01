import type { ReactNode } from 'react';
import { ApiError, isUnavailable } from '../api';
import { Button } from './Button';

interface Props {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Endpoint may not be deployed yet: 404/501 renders an "unavailable" notice instead of an error. */
  isOptionalEndpoint?: boolean;
  onRetry?: () => void;
  children: ReactNode;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}&hellip;
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
      <p>{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function UnavailableState({ what = 'This feature' }: { what?: string }) {
  return (
    <div role="status" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
      <p className="font-medium text-slate-800">{what} is not available yet</p>
      <p className="mt-1">The service that provides this data has not been enabled for your environment.</p>
    </div>
  );
}

/** Standard loading / error / empty / unavailable wrapper for any query-backed block. */
export function QueryState({ isLoading, error, isEmpty = false, emptyMessage = 'Nothing here yet.', isOptionalEndpoint = false, onRetry, children }: Props) {
  if (isLoading) return <Spinner />;
  if (error) {
    if (isOptionalEndpoint && isUnavailable(error)) return <UnavailableState />;
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p>{error instanceof ApiError || error instanceof Error ? error.message : 'Failed to load.'}</p>
        {onRetry && <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>Retry</Button>}
      </div>
    );
  }
  if (isEmpty) return <EmptyState message={emptyMessage} />;
  return <>{children}</>;
}
