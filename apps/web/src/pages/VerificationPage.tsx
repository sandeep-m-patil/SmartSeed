import { useState } from 'react';
import { BatchPicker } from '../components/BatchPicker';
import { EmptyState, QueryState } from '../components/QueryState';
import { PageHeader } from '../components/Layout';
import { PassportView, usePassport } from './BatchDetailPage';

/** Passport lookup for partners: pick a batch they can see and read its full passport and journey. */
export function VerificationPage() {
  const [batchId, setBatchId] = useState('');
  const q = usePassport(batchId || undefined);
  return (
    <div className="space-y-4">
      <PageHeader title="Verification" subtitle="Look up a batch passport and check its supply-chain history" />
      <div className="max-w-md"><BatchPicker value={batchId} onChange={setBatchId} /></div>
      {!batchId ? <EmptyState message="Choose a batch to view its passport." /> : (
        <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>{q.data && <PassportView passport={q.data} />}</QueryState>
      )}
    </div>
  );
}
