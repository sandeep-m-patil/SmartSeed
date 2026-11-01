import { AlertsTable } from '../components/AlertsTable';
import { PageHeader } from '../components/Layout';

export function AlertsPage() {
  return (
    <div>
      <PageHeader title="Risk Alerts" subtitle="Anomalies detected on your batches. Colour is always accompanied by a risk level label." />
      <AlertsTable caption="Risk alerts" />
    </div>
  );
}
