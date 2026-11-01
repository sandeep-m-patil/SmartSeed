import { lazy, Suspense, type ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAccess } from './components/RequireAccess';
import { Spinner } from './components/QueryState';
import { AlertsPage } from './pages/AlertsPage';
import { InvestigationsPage } from './pages/InvestigationsPage';
import { BillingPage } from './pages/BillingPage';
import { BatchDetailPage } from './pages/BatchDetailPage';
import { BatchesPage } from './pages/BatchesPage';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { InvestigationDetailPage } from './pages/InvestigationDetailPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { PartnersPage } from './pages/PartnersPage';
import { ProductsPage } from './pages/ProductsPage';
import { QrManagementPage } from './pages/QrManagementPage';
import { QrVerificationPage } from './pages/QrVerificationPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesPage } from './pages/SalesPage';
import { SettingsPage } from './pages/SettingsPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { TeamPage } from './pages/TeamPage';
import { TransfersPage } from './pages/TransfersPage';
import { VerificationPage } from './pages/VerificationPage';

const RiskManagementPage = lazy(() => import('./pages/RiskManagementPage').then((m) => ({ default: m.RiskManagementPage })));

const guarded = (ids: string[], element: ReactElement) => <RequireAccess ids={ids}>{element}</RequireAccess>;

export function App() {
  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/organizations" element={guarded(['organizations'], <OrganizationsPage />)} />
          <Route path="/risk-management" element={guarded(['risk-management'], <RiskManagementPage />)} />
          <Route path="/team" element={guarded(['team'], <TeamPage />)} />
          <Route path="/partners" element={guarded(['partners'], <PartnersPage />)} />
          <Route path="/products" element={guarded(['products'], <ProductsPage />)} />
          <Route path="/batches" element={guarded(['batches'], <BatchesPage />)} />
          <Route path="/batches/:id" element={guarded(['batches'], <BatchDetailPage />)} />
          <Route path="/qr" element={guarded(['qr'], <QrManagementPage />)} />
          <Route path="/inventory" element={guarded(['inventory'], <InventoryPage />)} />
          <Route path="/transfers" element={guarded(['transfers', 'shipments'], <TransfersPage title="Transfers" subtitle="Move stock to partner organizations" />)} />
          <Route path="/incoming" element={guarded(['incoming'], <TransfersPage title="Incoming Batches" subtitle="Accept or reject batches sent to you" fixedDirection="incoming" />)} />
          <Route path="/received" element={guarded(['received'], <TransfersPage title="Received Batches" subtitle="Batches delivered to your store" fixedDirection="incoming" />)} />
          <Route path="/verification" element={guarded(['verification'], <VerificationPage />)} />
          <Route path="/sales" element={guarded(['sales'], <SalesPage />)} />
          <Route path="/qr-verification" element={guarded(['qr-verification'], <QrVerificationPage />)} />
          <Route path="/reports" element={guarded(['reports'], <ReportsPage />)} />
          <Route path="/alerts" element={guarded(['alerts'], <AlertsPage />)} />
          <Route path="/investigations" element={guarded(['investigations'], <InvestigationsPage />)} />
          <Route path="/investigations/:id" element={guarded(['investigations'], <InvestigationDetailPage />)} />
          <Route path="/subscription" element={guarded(['subscription'], <SubscriptionPage />)} />
          <Route path="/billing" element={guarded(['billing'], <BillingPage />)} />
          <Route path="/settings" element={guarded(['settings'], <SettingsPage />)} />
          <Route path="/notifications" element={<RequireAccess permission="notification:read"><NotificationsPage /></RequireAccess>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
