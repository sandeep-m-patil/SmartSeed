import { useEffect, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { TextAreaField } from './Field';

interface Props {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  label?: string;
  minLength?: number;
  maxLength?: number;
  isDanger?: boolean;
  isBusy?: boolean;
  error?: string | null;
  onSubmit(reason: string): void;
  onCancel(): void;
}

const DEFAULT_MIN = 3;
const DEFAULT_MAX = 300;

/** Confirmation that requires a written reason (revoke, reject...). Validates length before submitting. */
export function ReasonDialog({ open, title, message, confirmLabel, label = 'Reason', minLength = DEFAULT_MIN, maxLength = DEFAULT_MAX, isDanger = false, isBusy = false, error, onSubmit, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  useEffect(() => {
    if (open) { setReason(''); setFieldError(undefined); }
  }, [open]);

  function confirm() {
    const trimmed = reason.trim();
    if (trimmed.length < minLength) return setFieldError(`Enter at least ${minLength} characters`);
    if (trimmed.length > maxLength) return setFieldError(`Keep it under ${maxLength} characters`);
    onSubmit(trimmed);
  }

  return (
    <ConfirmDialog open={open} title={title} message={message} confirmLabel={confirmLabel} isDanger={isDanger} isBusy={isBusy} error={error ?? null} onConfirm={confirm} onCancel={onCancel}>
      <TextAreaField label={label} value={reason} error={fieldError} maxLength={maxLength + 50}
        onChange={(e) => { setReason(e.target.value); setFieldError(undefined); }} />
    </ConfirmDialog>
  );
}
