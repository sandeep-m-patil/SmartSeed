import { useEffect } from 'react';
import { acceptTransferSchema } from '@smartseed/shared';
import { useAction } from '../../hooks/useAction';
import { useFormState } from '../../hooks/useFormState';
import { blankToUndefined, toOptionalNumber, validate } from '../../lib/validation';
import type { Transfer } from '../../types';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { TextAreaField, TextField } from '../Field';

/** Variance between expected and received units; negative means short-shipped. */
export const varianceOf = (expected: number, received: number | undefined): number => (received === undefined ? 0 : received - expected);

export function AcceptDialog({ transfer, onClose }: { transfer: Transfer | null; onClose(): void }) {
  const form = useFormState({ receivedQuantity: '', note: '' });
  const { set, reset } = form;
  useEffect(() => {
    if (transfer) { reset(); set('receivedQuantity', String(transfer.quantity)); }
  }, [transfer, set, reset]);

  const accept = useAction({
    run: (body: unknown, api) => api.send(`/v1/transfers/${transfer?.id}/accept`, { body }),
    success: 'Batch accepted into your inventory',
    invalidate: ['transfers', 'inventory', 'snapshot'],
    onDone: onClose,
  });
  const received = toOptionalNumber(form.values.receivedQuantity);
  const variance = transfer ? varianceOf(transfer.quantity, received) : 0;
  const submit = () => {
    const result = validate(acceptTransferSchema, { receivedQuantity: received, note: blankToUndefined(form.values.note) });
    if (!result.ok) return form.setErrors(result.errors);
    accept.mutate(result.data);
  };
  return (
    <Dialog open={transfer !== null} title={`Accept batch${transfer?.batchCode ? ` ${transfer.batchCode}` : ''}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={accept.isPending}>Accept</Button></>}>
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="text-sm text-slate-600">Expected quantity: <strong>{transfer?.quantity.toLocaleString()}</strong>. Enter what you actually received.</p>
        <TextField label="Received quantity" inputMode="numeric" value={form.values.receivedQuantity} error={form.errors.receivedQuantity} onChange={(e) => form.set('receivedQuantity', e.target.value)} />
        {variance !== 0 && Number.isFinite(variance) && (
          <p role="status" className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            Variance of {Math.abs(variance).toLocaleString()} units ({variance < 0 ? 'short' : 'over'}). This discrepancy is recorded and may raise an inventory alert.
          </p>
        )}
        <TextAreaField label="Note (optional)" value={form.values.note} error={form.errors.note} onChange={(e) => form.set('note', e.target.value)} />
        {accept.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{accept.errorText}</p>}
      </form>
    </Dialog>
  );
}
