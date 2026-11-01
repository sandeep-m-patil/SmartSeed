import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const CONTROL =
  'mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 disabled:bg-slate-100';
const OK = 'border-slate-300 focus:border-brand-600 focus:ring-brand-600/40';
const BAD = 'border-red-500 focus:border-red-600 focus:ring-red-500/40';

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (a11y: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined; className: string }) => ReactNode;
}

/** Label + control + inline error wired together for screen readers. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-msg`;
  const hasMessage = Boolean(error || hint);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': hasMessage ? messageId : undefined, className: `${CONTROL} ${error ? BAD : OK}` })}
      {error ? <p id={messageId} role="alert" className="mt-1 text-xs text-red-700">{error}</p> : hint ? <p id={messageId} className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

type Common = { label: string; error?: string | undefined; hint?: string };

export function TextField({ label, error, hint, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} error={error} {...(hint ? { hint } : {})}>{(p) => <input {...p} {...rest} />}</Field>;
}

export function TextAreaField({ label, error, hint, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label} error={error} {...(hint ? { hint } : {})}>{(p) => <textarea rows={3} {...p} {...rest} />}</Field>;
}

export interface Option { value: string; label: string }

export function SelectField({ label, error, hint, options, placeholder, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string }) {
  return (
    <Field label={label} error={error} {...(hint ? { hint } : {})}>
      {(p) => (
        <select {...p} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}
