import { dispatchTransferSchema } from '@smartseed/shared';
import { useAction } from '../../hooks/useAction';
import { useFormState } from '../../hooks/useFormState';
import { blankToUndefined, validate } from '../../lib/validation';
import type { Transfer } from '../../types';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { TextField } from '../Field';

const INITIAL = { sourceLocation: '', destinationLocation: '', carrier: '', vehicleRef: '' };

export function DispatchDialog({ transfer, onClose }: { transfer: Transfer | null; onClose(): void }) {
  const form = useFormState(INITIAL);
  const dispatch = useAction({
    run: (body: unknown, api) => api.send(`/v1/transfers/${transfer?.id}/dispatch`, { body }),
    success: 'Transfer dispatched',
    invalidate: ['transfers', 'inventory', 'snapshot'],
    onDone: () => { form.reset(); onClose(); },
  });
  const submit = () => {
    const v = form.values;
    const result = validate(dispatchTransferSchema, { ...v, carrier: blankToUndefined(v.carrier), vehicleRef: blankToUndefined(v.vehicleRef) });
    if (!result.ok) return form.setErrors(result.errors);
    dispatch.mutate(result.data);
  };
  const field = (name: keyof typeof INITIAL, label: string) => (
    <TextField label={label} value={form.values[name]} error={form.errors[name]} onChange={(e) => form.set(name, e.target.value)} />
  );
  return (
    <Dialog open={transfer !== null} title={`Dispatch transfer${transfer?.batchCode ? ` - ${transfer.batchCode}` : ''}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={dispatch.isPending}>Dispatch</Button></>}>
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="text-sm text-slate-600">Dispatching reserves and moves {transfer?.quantity.toLocaleString()} units out of your stock.</p>
        {field('sourceLocation', 'Source location')}
        {field('destinationLocation', 'Destination location')}
        {field('carrier', 'Carrier (optional)')}
        {field('vehicleRef', 'Vehicle reference (optional)')}
        {dispatch.errorText && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{dispatch.errorText}</p>}
      </form>
    </Dialog>
  );
}
