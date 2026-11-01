import type { Role } from '@smartseed/shared';

export interface Me {
  id: string; email: string; fullName: string; tenantId: string | null; orgId: string | null; orgType: string | null; orgName: string | null; roles: Role[];
}
export interface Tenant { id: string; name: string; slug: string; status: 'pending' | 'active' | 'suspended'; created_at: string }
export interface UserRow { id: string; email: string; fullName: string; roles: string[]; mfaEnabled: boolean }
export interface Org { id: string; type: string; legalName: string; registrationNo: string; status: string }

export interface Product {
  id: string; name: string; brand: string; cropType: string; variety: string; category: string; description: string; createdAt: string;
}

export interface Batch {
  id: string; productId: string; productName?: string; brand?: string; batchCode: string; manufacturingDate: string;
  expiryDate: string; productionLocation: string; facility: string; initialQuantity: number; unit: string; status: string;
  expired: boolean; recordHash: string; createdAt: string;
}

export interface Certification { type: string; issuer: string; number: string; validFrom?: string | null; validTo?: string | null }

export interface JourneyEvent {
  sequence: number; eventType: string; occurredAt: string; quantity: number | null; actorName: string | null;
  counterpartyName: string | null; recordHash: string; chainStatus: string | null; chainTxId: string | null; blockNumber?: number | null;
}

export interface Passport {
  id: string; batchCode: string; manufacturingDate: string; expiryDate: string; expired: boolean; productionLocation: string;
  facility: string; initialQuantity: number; unit: string; status: string; ledgerStatus: string; recordHash: string;
  productName: string; brand: string; cropType: string; variety: string; category: string; manufacturerName: string | null;
  certifications: Certification[]; qrCodes: { id: string; kind: string; status: string; issuedAt: string }[];
  journey: JourneyEvent[]; risk: { score: number; level: string; computedAt: string } | null;
  investigationWarnings: { id: string; alertType: string; severity: string; status: string; summary: string }[];
}

export type TransferStatus = 'created' | 'dispatched' | 'in_transit' | 'received' | 'rejected' | 'cancelled';

export interface Transfer {
  id: string; batchId: string; batchCode?: string; fromOrgId: string; fromOrgName?: string | null; toOrgId: string;
  toOrgName?: string | null; quantity: number; receivedQuantity: number | null; status: TransferStatus;
  underInvestigation: boolean; sourceLocation: string | null; destinationLocation: string | null; carrier: string | null;
  vehicleRef: string | null; dispatchedAt: string | null; receivedAt: string | null; note: string | null; createdAt: string;
}

export interface InventoryRow {
  batchId: string; batchCode: string; productName: string; brand: string; expiryDate: string; expired: boolean;
  batchStatus: string; quantity: number; reserved: number; available: number;
}

export interface Movement { id: string; delta: number; balanceAfter: number; reason: string; refType: string | null; refId: string | null; createdAt: string }

export interface Qr {
  id: string; batchId: string; packageId: string | null; kind: 'batch' | 'package'; status: string; issuedAt: string;
  revokedAt: string | null; revokeReason: string | null;
}

export interface SaleResult { sold: number; remaining: number; replayed: boolean }

// ---- risk contract (backend pending) ----
export interface RiskOverview {
  totalBatches: number; totalScans: number; suspiciousScans: number; highRiskBatches: number; criticalAlerts: number;
  investigations: { total: number; resolved: number; pending: number };
}

export interface RiskAnalytics {
  riskDistribution: { level: string; count: number }[];
  dailyAnomalies: { day: string; count: number }[];
  geo: { lat: number; lon: number; count: number }[];
  topFlaggedBatches: { batchId: string; batchCode: string; alerts: number; maxScore: number }[];
  stakeholderActivity: { orgId: string; orgName: string; blockedAttempts: number }[];
  duplicateScans: { qrId: string; batchCode: string; distinctDevices: number; scans: number }[];
  inventoryMismatches: { discrepancies: number; alerts: number };
}

export interface Alert {
  id: string; batchId: string; batchCode: string; productName: string; alertType: string; severity: string; riskScore: number;
  status: string; detectedAt: string; assigneeId: string | null; assigneeName: string | null; summary: string;
  investigationId: string | null; investigationStatus: string | null; resolution: unknown;
}

export type FindingKind = 'observed_fact' | 'model_interpretation' | 'hypothesis';

export interface Investigation {
  id: string; alertId: string; batchId: string; status: string; requiresHumanReview: boolean; generatedBy: string;
  report: {
    investigationId: string; batchId: string; riskScore: number; riskCategory: string; mainSuspiciousActivity: string;
    findings: { kind: FindingKind; text: string; evidenceRefs: string[] }[];
    timeline: { at: string; event: string; ref: string }[];
    potentialExplanation: string; recommendedSteps: string[]; confidenceAndLimitations: string; droppedFindings?: number;
  };
  createdAt?: string; updatedAt?: string;
  evidence?: { kind: string; recordType: string | null; recordId: string | null; summary: string }[];
  actions: { action: string; actorName: string; note: string | null; createdAt: string }[];
}

export type InvestigationAction =
  | 'mark_under_investigation' | 'request_verification' | 'confirm_suspicious' | 'dismiss_false_positive'
  | 'escalate_manufacturer' | 'escalate_authority' | 'mark_resolved';

export interface AppNotification { id: string; type: string; title?: string; message?: string; body?: string | null; createdAt?: string; created_at?: string; readAt: string | null }
export interface Plan { code: string; name: string; limits: Record<string, number | null>; priceMinor: number; currency: string; billingInterval: string; isActive: boolean; gatewayPlanId: string | null }
export interface NotificationPref { type: string; channel: string; enabled: boolean }

export interface Subscription {
  plan: { code: string; name: string; limits: Record<string, number | null> }; status: string; trialEndsAt: string | null; renewsAt: string | null;
}
export interface Usage { [k: string]: { used: number; limit: number | null } }
export interface AuditEntry { id: string; action: string; entityType?: string; entity_type?: string; created_at?: string; createdAt?: string; actorId?: string | null }
