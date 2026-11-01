import { useState } from 'react';
import { errorMessage } from '../api';
import { useAction } from '../hooks/useAction';
import { useApi } from '../hooks/useApi';
import { usePagedList } from '../hooks/usePagedList';
import { useRoles } from '../hooks/useMe';
import { formatDateTime, shortId } from '../lib/format';
import type { Qr } from '../types';
import { Button } from './Button';
import { Card } from './Layout';
import { DataTable, type Column } from './DataTable';
import { TextField } from './Field';
import { Pagination } from './Pagination';
import { QueryState } from './QueryState';
import { ReasonDialog } from './ReasonDialog';
import { StatusBadge } from './Badge';
import { useToast } from './Toast';

type Format = 'png' | 'svg' | 'label';
type Target = { qr: Qr; kind: 'revoke' | 'regenerate' };
const MAX_PACKAGES = 5_000;
const EXTENSIONS: Record<Format, string> = { png: 'png', svg: 'svg', label: 'label.svg' };

function validateCount(raw: string): { count?: number; error?: string } {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(n)) return { error: 'Enter a whole number' };
  if (n < 1 || n > MAX_PACKAGES) return { error: `Enter a number between 1 and ${MAX_PACKAGES.toLocaleString()}` };
  return { count: n };
}

function PackageForm({ batchId }: { batchId: string }) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | undefined>();
  const gen = useAction({
    run: (count: number, api) => api.send<{ count: number; firstSerial: number; lastSerial: number }>(`/v1/batches/${batchId}/packages`, { body: { count } }),
    success: (r) => `Generated ${r.data.count} package QR codes (serials ${r.data.firstSerial}-${r.data.lastSerial})`,
    invalidate: ['qr'],
    onDone: () => setRaw(''),
  });
  return (
    <form className="flex flex-wrap items-start gap-2" noValidate onSubmit={(e) => {
      e.preventDefault();
      const r = validateCount(raw);
      setError(r.error);
      if (r.count) gen.mutate(r.count);
    }}>
      <div className="w-44"><TextField label="Package QR count" inputMode="numeric" value={raw} error={error ?? gen.errorText ?? undefined} onChange={(e) => { setRaw(e.target.value); setError(undefined); }} /></div>
      <Button type="submit" variant="secondary" className="mt-6" isLoading={gen.isPending}>Generate package QRs</Button>
    </form>
  );
}

function useDownload() {
  const api = useApi();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  async function download(qr: Qr, format: Format) {
    setBusyId(qr.id);
    try {
      const blob = await api.blob(`/v1/qr/${qr.id}/download?format=${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-${qr.id.slice(0, 8)}.${EXTENSIONS[format]}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err, 'Download failed'));
    } finally {
      setBusyId(null);
    }
  }
  return { download, busyId };
}

/** QR management for one batch: generate, download, revoke, regenerate. Mutating controls need qr:manage. */
export function QrPanel({ batchId }: { batchId: string }) {
  const { can } = useRoles();
  const canManage = can('qr:manage');
  const list = usePagedList<Qr>({ queryKey: 'qr', path: `/v1/batches/${batchId}/qr` });
  const { download, busyId } = useDownload();
  const [target, setTarget] = useState<Target | null>(null);
  const createBatchQr = useAction({ run: (_: void, api) => api.send(`/v1/batches/${batchId}/qr`, { body: {} }), success: 'Batch QR generated', invalidate: ['qr'] });
  const act = useAction<{ t: Target; reason: string }>({
    run: ({ t, reason }, api) => api.send(`/v1/qr/${t.qr.id}/${t.kind}`, { body: { reason } }),
    success: (_r, { t }) => (t.kind === 'revoke' ? 'QR code revoked' : 'QR code regenerated; the old code is now superseded'),
    invalidate: ['qr', 'passport'],
    onDone: () => setTarget(null),
  });

  const columns: Column<Qr>[] = [
    { key: 'kind', header: 'Type', cell: (q) => (q.kind === 'batch' ? 'Batch QR' : 'Package QR') },
    { key: 'id', header: 'ID', cell: (q) => shortId(q.id), isSecondary: true },
    { key: 'status', header: 'Status', cell: (q) => <StatusBadge status={q.status} /> },
    { key: 'issued', header: 'Issued', cell: (q) => formatDateTime(q.issuedAt), isSecondary: true },
    {
      key: 'actions', header: 'Actions',
      cell: (q) => q.status !== 'active' ? <span className="text-xs text-slate-500">{q.revokeReason ?? '-'}</span> : (
        <div className="flex flex-wrap gap-1">
          {(['png', 'svg', 'label'] as Format[]).map((f) => (
            <Button key={f} size="sm" variant="secondary" isLoading={busyId === q.id} onClick={() => void download(q, f)} aria-label={`Download ${f} for QR ${shortId(q.id)}`}>{f.toUpperCase()}</Button>
          ))}
          {canManage && <Button size="sm" variant="secondary" onClick={() => { act.reset(); setTarget({ qr: q, kind: 'regenerate' }); }}>Regenerate</Button>}
          {canManage && <Button size="sm" variant="danger" onClick={() => { act.reset(); setTarget({ qr: q, kind: 'revoke' }); }}>Revoke</Button>}
        </div>
      ),
    },
  ];
  const hasActiveBatchQr = list.items.some((q) => q.kind === 'batch' && q.status === 'active');

  return (
    <Card title="QR codes">
      {canManage && (
        <div className="mb-4 space-y-3 border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => createBatchQr.mutate()} isLoading={createBatchQr.isPending} disabled={hasActiveBatchQr}>Generate batch QR</Button>
            {hasActiveBatchQr && <span className="text-xs text-slate-500">An active batch QR exists; use Regenerate to replace it.</span>}
          </div>
          {createBatchQr.errorText && <p role="alert" className="text-sm text-red-700">{createBatchQr.errorText}</p>}
          <PackageForm batchId={batchId} />
        </div>
      )}
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={list.items.length === 0} emptyMessage="No QR codes issued for this batch." onRetry={list.refetch}>
        <DataTable caption="QR codes" columns={columns} rows={list.items} rowKey={(q) => q.id} />
        <Pagination pager={list.pager} nextCursor={list.nextCursor} isFetching={list.isFetching} />
      </QueryState>
      <ReasonDialog
        open={target !== null}
        title={target?.kind === 'revoke' ? 'Revoke QR code?' : 'Regenerate QR code?'}
        message={target?.kind === 'revoke' ? 'A revoked code can no longer be verified as valid. This cannot be undone.' : 'A replacement code is issued and the current one is marked superseded. Printed labels must be replaced.'}
        confirmLabel={target?.kind === 'revoke' ? 'Revoke' : 'Regenerate'}
        isDanger={target?.kind === 'revoke'}
        isBusy={act.isPending}
        error={act.errorText}
        onSubmit={(reason) => target && act.mutate({ t: target, reason })}
        onCancel={() => setTarget(null)}
      />
    </Card>
  );
}
