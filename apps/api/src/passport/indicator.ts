export type DigitalIdentity = 'VALID' | 'REVOKED' | 'UNKNOWN';
export type ChainStatus = 'VERIFIED' | 'UNVERIFIED' | 'FAILED';
export type ScanActivity = 'NORMAL' | 'SUSPICIOUS';
export type InvestigationState = 'NONE' | 'UNDER_INVESTIGATION' | 'CONFIRMED_COUNTERFEIT';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Indicator = 'GREEN' | 'YELLOW' | 'RED';

export interface Verification {
  digitalIdentity: DigitalIdentity;
  blockchain: ChainStatus;
  scanActivity: ScanActivity;
  investigation: InvestigationState;
}

/**
 * GREEN only when every independent check is clean. A valid QR alone never yields GREEN, and a
 * failed or unconfirmed blockchain check can never be GREEN.
 */
export function deriveIndicator(v: Verification, level: RiskLevel, expired: boolean): Indicator {
  const isRed =
    v.digitalIdentity !== 'VALID' || v.blockchain === 'FAILED' || v.investigation === 'CONFIRMED_COUNTERFEIT' ||
    level === 'CRITICAL' || level === 'HIGH';
  if (isRed) return 'RED';
  const isGreen =
    v.blockchain === 'VERIFIED' && v.scanActivity === 'NORMAL' && v.investigation === 'NONE' && level === 'LOW' && !expired;
  return isGreen ? 'GREEN' : 'YELLOW';
}

export function buildWarnings(v: Verification, level: RiskLevel, expired: boolean, superseded: boolean): string[] {
  const warnings: string[] = [];
  if (v.digitalIdentity === 'UNKNOWN') warnings.push('QR_UNKNOWN');
  if (v.digitalIdentity === 'REVOKED') warnings.push(superseded ? 'QR_SUPERSEDED' : 'QR_REVOKED');
  if (expired) warnings.push('BATCH_EXPIRED');
  if (v.blockchain === 'FAILED') warnings.push('CHAIN_VERIFICATION_FAILED');
  if (v.blockchain === 'UNVERIFIED') warnings.push('CHAIN_NOT_YET_CONFIRMED');
  if (v.scanActivity === 'SUSPICIOUS') warnings.push('SUSPICIOUS_SCAN_ACTIVITY');
  if (v.investigation === 'UNDER_INVESTIGATION') warnings.push('UNDER_INVESTIGATION');
  if (v.investigation === 'CONFIRMED_COUNTERFEIT') warnings.push('CONFIRMED_COUNTERFEIT');
  if (level === 'HIGH' || level === 'CRITICAL') warnings.push('HIGH_RISK');
  return warnings;
}
