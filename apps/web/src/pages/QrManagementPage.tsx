import { useState } from 'react';
import { BatchPicker } from '../components/BatchPicker';
import { EmptyState } from '../components/QueryState';
import { PageHeader } from '../components/Layout';
import { QrPanel } from '../components/QrPanel';

export function QrManagementPage() {
  const [batchId, setBatchId] = useState('');
  return (
    <div className="space-y-4">
      <PageHeader title="QR Management" subtitle="Issue, download, revoke and regenerate QR codes for a batch" />
      <div className="max-w-md"><BatchPicker value={batchId} onChange={setBatchId} /></div>
      {batchId ? <QrPanel batchId={batchId} /> : <EmptyState message="Choose a batch to manage its QR codes." />}
    </div>
  );
}
