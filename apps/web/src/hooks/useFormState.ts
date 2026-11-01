import { useCallback, useState } from 'react';
import type { FieldErrors } from '../lib/validation';

export interface FormState<V extends Record<string, string>> {
  values: V;
  errors: FieldErrors;
  set(name: keyof V & string, value: string): void;
  setErrors(errors: FieldErrors): void;
  reset(): void;
}

/** Minimal controlled-form state: string values, per-field errors that clear when the field is edited. */
export function useFormState<V extends Record<string, string>>(initial: V): FormState<V> {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = useCallback((name: keyof V & string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => {
      if (!(name in e)) return e;
      const { [name]: _removed, ...rest } = e;
      return rest;
    });
  }, []);
  const reset = useCallback(() => {
    setValues(initial);
    setErrors({});
  }, [initial]);

  return { values, errors, set, setErrors, reset };
}
