import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  isDanger?: boolean;
  isBusy?: boolean;
  error?: string | null;
  onConfirm(): void;
  onCancel(): void;
  /** Optional extra inputs (reason, note...). */
  children?: ReactNode;
}

/** Confirmation for destructive or state-changing actions. Cancel is focused first to avoid accidental confirms. */
export function ConfirmDialog({ open, title, message, confirmLabel, isDanger = false, isBusy = false, error, onConfirm, onCancel, children }: Props) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={isBusy ? () => undefined : onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isBusy} data-autofocus>Cancel</Button>
          <Button variant={isDanger ? 'danger' : 'primary'} onClick={onConfirm} isLoading={isBusy}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        <div>{message}</div>
        {children}
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">{error}</p>}
      </div>
    </Dialog>
  );
}
