import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../api';
import { useToast } from '../components/Toast';
import { useApi, type ApiClient } from './useApi';

interface Options<V, R> {
  run(vars: V, api: ApiClient): Promise<R>;
  /** Success toast text. */
  success: string | ((result: R, vars: V) => string);
  /** Query-key prefixes to invalidate on success. */
  invalidate?: string[];
  onDone?(result: R, vars: V): void;
}

/** State-changing request with a success toast, query invalidation and a readable error message. */
export function useAction<V, R = unknown>({ run, success, invalidate = [], onDone }: Options<V, R>) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (vars: V) => run(vars, api),
    onSuccess: async (result, vars) => {
      toast.success(typeof success === 'function' ? success(result, vars) : success);
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onDone?.(result, vars);
    },
  });
  return { ...mutation, errorText: mutation.error ? errorMessage(mutation.error) : null };
}
