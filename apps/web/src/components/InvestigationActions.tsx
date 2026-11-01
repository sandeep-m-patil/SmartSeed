import { useState } from 'react';
import { useAction } from '../hooks/useAction';
import type { InvestigationAction } from '../types';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { SelectField, TextAreaField } from './Field';

interface ActionDef { action: InvestigationAction; label: string; description: string; isDanger?: boolean }

export const INVESTIGATION_ACTIONS: ActionDef[] = [
  { action: 'mark_under_investigation', label: 'Mark under investigation', description: 'Record that your team has started investigating this alert.' },
  { action: 'request_verification', label: 'Request verification', description: 'Ask the batch owner or partners to physically verify stock.' },
  { action: 'confirm_suspicious', label: 'Confirm suspicious', description: 'Record that the activity is considered suspicious. This is visible in the batch passport.', isDanger: true },
  { action: 'dismiss_false_positive', label: 'Dismiss as false positive', description: 'Close the alert as a false positive. The decision is logged.' },
  { action: 'escalate_manufacturer', label: 'Escalate to manufacturer', description: 'Notify the manufacturer for action.' },
  { action: 'escalate_authority', label: 'Escalate to authority', description: 'Escalate to the regulatory authority. Use only for confirmed counterfeit concerns.', isDanger: true },
  { action: 'mark_resolved', label: 'Mark resolved', description: 'Close the investigation with an outcome.' },
];

const OUTCOMES = [
  { value: 'confirmed_counterfeit', label: 'Confirmed counterfeit' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'inconclusive', label: 'Inconclusive' },
];

/** Decision buttons for an investigation; every action opens a confirmation (with optional note / required outcome). */
export function InvestigationActions({ investigationId }: { investigationId: string }) {
  const [current, setCurrent] = useState<ActionDef | null>(null);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const [outcomeError, setOutcomeError] = useState<string | undefined>();
  const close = () => { setCurrent(null); setNote(''); setOutcome(''); setOutcomeError(undefined); };
  const run = useAction<ActionDef>({
    run: (def, api) => api.send(`/v1/investigations/${investigationId}/actions`, {
      body: { action: def.action, ...(note.trim() ? { note: note.trim() } : {}), ...(def.action === 'mark_resolved' ? { outcome } : {}) },
    }),
    success: (_r, def) => `Recorded: ${def.label}`,
    invalidate: ['investigation', 'alerts', 'risk-overview'],
    onDone: close,
  });

  function confirm() {
    if (!current) return;
    if (current.action === 'mark_resolved' && !outcome) return setOutcomeError('Choose an outcome');
    run.mutate(current);
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {INVESTIGATION_ACTIONS.map((d) => (
          <Button key={d.action} size="sm" variant={d.isDanger ? 'danger' : 'secondary'} onClick={() => { run.reset(); setCurrent(d); }}>{d.label}</Button>
        ))}
      </div>
      <ConfirmDialog open={current !== null} title={current?.label ?? ''} message={current?.description} confirmLabel="Confirm" isDanger={Boolean(current?.isDanger)} isBusy={run.isPending} error={run.errorText} onConfirm={confirm} onCancel={close}>
        {current?.action === 'mark_resolved' && (
          <SelectField label="Outcome" value={outcome} error={outcomeError} options={OUTCOMES} placeholder="Select an outcome" onChange={(e) => { setOutcome(e.target.value); setOutcomeError(undefined); }} />
        )}
        <TextAreaField label="Note (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
