import { useQuery } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { COUNT_FETCH_LIMIT } from '../lib/constants';
import type { Batch } from '../types';
import { SelectField } from './Field';

interface Props { value: string; onChange(id: string): void; label?: string }

/** Select of the batches visible to the user (first 100, newest first). */
export function BatchPicker({ value, onChange, label = 'Batch' }: Props) {
  const api = useApi();
  const q = useQuery({ queryKey: ['batches', 'options'], queryFn: () => api.page<Batch>(`/v1/batches?limit=${COUNT_FETCH_LIMIT}`) });
  const options = (q.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.batchCode} - ${b.productName ?? 'product'}` }));
  return (
    <SelectField label={label} value={value} options={options} placeholder={q.isLoading ? 'Loading batches...' : q.error ? 'Could not load batches' : 'Select a batch'}
      onChange={(e) => onChange(e.target.value)} />
  );
}
