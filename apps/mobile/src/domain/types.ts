export type DigitalIdentity = 'VALID' | 'REVOKED' | 'UNKNOWN';
export type BlockchainStatus = 'VERIFIED' | 'UNVERIFIED' | 'FAILED';
export type ScanActivity = 'NORMAL' | 'SUSPICIOUS';
export type Investigation = 'NONE' | 'UNDER_INVESTIGATION' | 'CONFIRMED_COUNTERFEIT';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Indicator = 'GREEN' | 'YELLOW' | 'RED';
/** What the UI may show. LAST_CHECKED is the neutral state used for stale/cached former-GREEN results. */
export type DisplayIndicator = Indicator | 'LAST_CHECKED';

export interface Verification {
  digitalIdentity: DigitalIdentity;
  blockchain: BlockchainStatus;
  scanActivity: ScanActivity;
  investigation: Investigation;
}

export interface Risk {
  score: number;
  level: RiskLevel;
  /** false = never scored yet; the UI must not present `level` (e.g. LOW) as an assessment. */
  assessed: boolean;
}

export interface JourneyStep {
  /** Server codes (MANUFACTURED | RECEIVED | SOLD ...). Never shown raw; mapped via locale keys. */
  step: string;
  orgType: string;
  at: string;
  status: string;
}

export interface Certification {
  type: string;
  issuer: string;
  number: string;
  validTo: string | null;
}

export interface Batch {
  code: string;
  mfgDate: string;
  expiryDate: string;
  expired: boolean;
}

export interface VerifyResult {
  /** product/manufacturer/batch are null when the code is not recognised (digitalIdentity UNKNOWN). */
  product: { name: string; brand: string; cropType: string; variety: string } | null;
  manufacturer: { name: string } | null;
  batch: Batch | null;
  package: { serialNo: string } | null;
  certifications: Certification[];
  journey: JourneyStep[];
  verification: Verification;
  risk: Risk;
  indicator: Indicator;
  /** Warning CODES (not text); localized via domain/warnings. */
  warnings: string[];
  asOf: string;
}

export interface CachedResult {
  token: string;
  result: VerifyResult;
  fetchedAt: number;
}

export interface HistoryEntry {
  token: string;
  productName: string;
  batchCode: string;
  checkedAt: number;
}
