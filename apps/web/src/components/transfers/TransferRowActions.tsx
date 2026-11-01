import { useState } from 'react';
import { useAction } from '../../hooks/useAction';
import type { Transfer } from '../../types';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog';
import { ReasonDialog } from '../ReasonDialog';
import { AcceptDialog } from './AcceptDialog';
import { DispatchDialog } from './DispatchDialog';

export type Direction = 'incoming' | 'outgoing';
type Dialogs = 'dispatch' | 'transit' | 'cancel' | 'accept' | 'reject' | null;

const REFRESH = ['transfers', 'inventory', 'snapshot'];

/** Which actions the current state of a transfer offers, by the side the viewer is on. */
export function availableActions(t: Pick<Transfer, 'status'>, direction: Direction, perms: { canCreate: boolean; canReceive: boolean }): Exclude<Dialogs, null>[] {
  if (direction === 'outgoing' && perms.canCreate) {
    if (t.status === 'created') return ['dispatch', 'cancel'];
    if (t.status === 'dispatched') return ['transit', 'cancel'];
  }
  if (direction === 'incoming' && perms.canReceive && (t.status === 'dispatched' || t.status === 'in_transit')) return ['accept', 'reject'];
  return [];
}

export function TransferRowActions({ transfer, direction, canCreate, canReceive }: { transfer: Transfer; direction: Direction; canCreate: boolean; canReceive: boolean }) {
  const [open, setOpen] = useState<Dialogs>(null);
  const close = () => setOpen(null);
  const transit = useAction({ run: (_: void, api) => api.send(`/v1/transfers/${transfer.id}/transit`, { body: {} }), success: 'Marked in transit', invalidate: REFRESH, onDone: close });
  const cancel = useAction({ run: (_: void, api) => api.send(`/v1/transfers/${transfer.id}/cancel`, { body: {} }), success: 'Transfer cancelled', invalidate: REFRESH, onDone: close });
  const reject = useAction({ run: (reason: string, api) => api.send(`/v1/transfers/${transfer.id}/reject`, { body: { reason } }), success: 'Batch rejected', invalidate: REFRESH, onDone: close });
  const actions = availableActions(transfer, direction, { canCreate, canReceive });
  if (actions.length === 0) return null;
  const label = `${transfer.batchCode ?? 'transfer'}`;

  return (
    <div className="flex flex-wrap gap-1">
      {actions.includes('dispatch') && <Button size="sm" onClick={() => setOpen('dispatch')}>Dispatch</Button>}
      {actions.includes('transit') && <Button size="sm" variant="secondary" onClick={() => { transit.reset(); setOpen('transit'); }}>Mark in transit</Button>}
      {actions.includes('cancel') && <Button size="sm" variant="danger" onClick={() => { cancel.reset(); setOpen('cancel'); }}>Cancel</Button>}
      {actions.includes('accept') && <Button size="sm" onClick={() => setOpen('accept')}>Accept</Button>}
      {actions.includes('reject') && <Button size="sm" variant="danger" onClick={() => { reject.reset(); setOpen('reject'); }}>Reject</Button>}

      <DispatchDialog transfer={open === 'dispatch' ? transfer : null} onClose={close} />
      <AcceptDialog transfer={open === 'accept' ? transfer : null} onClose={close} />
      <ConfirmDialog open={open === 'transit'} title="Mark as in transit?" message={`Confirm that ${label} has left for its destination.`} confirmLabel="Mark in transit" isBusy={transit.isPending} error={transit.errorText} onConfirm={() => transit.mutate()} onCancel={close} />
      <ConfirmDialog open={open === 'cancel'} title="Cancel transfer?" message={`Cancelling ${label} releases any reserved stock back to you. This cannot be undone.`} confirmLabel="Cancel transfer" isDanger isBusy={cancel.isPending} error={cancel.errorText} onConfirm={() => cancel.mutate()} onCancel={close} />
      <ReasonDialog open={open === 'reject'} title="Reject batch?" message="Rejected stock is returned to the sender and the transfer is flagged for review." confirmLabel="Reject batch" maxLength={500} isDanger isBusy={reject.isPending} error={reject.errorText} onSubmit={(r) => reject.mutate(r)} onCancel={close} />
    </div>
  );
}
