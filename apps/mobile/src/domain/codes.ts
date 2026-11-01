/** Maps server codes to locale keys. Unknown/future codes fall back to a generic localized message, never the raw code. */

export const WARNING_CODES = [
  'QR_UNKNOWN',
  'QR_REVOKED',
  'QR_SUPERSEDED',
  'BATCH_EXPIRED',
  'CHAIN_VERIFICATION_FAILED',
  'CHAIN_NOT_YET_CONFIRMED',
  'SUSPICIOUS_SCAN_ACTIVITY',
  'UNDER_INVESTIGATION',
  'CONFIRMED_COUNTERFEIT',
  'HIGH_RISK',
] as const;
export const JOURNEY_STEPS = ['MANUFACTURED', 'RECEIVED', 'SOLD'] as const;
export const ORG_TYPES = ['manufacturer', 'distributor', 'wholesaler', 'retailer'] as const;
export const JOURNEY_STATUSES = ['CONFIRMED'] as const;

const FALLBACK = 'OTHER';

function keyFor(prefix: string, known: readonly string[], code: string): string {
  return `${prefix}.${known.includes(code) ? code : FALLBACK}`;
}

export const warningKey = (code: string) => keyFor('warning', WARNING_CODES, code);
export const journeyStepKey = (code: string) => keyFor('journey.step', JOURNEY_STEPS, code);
export const orgTypeKey = (code: string) => keyFor('journey.orgType', ORG_TYPES, code);
export const journeyStatusKey = (code: string) => keyFor('journey.status', JOURNEY_STATUSES, code);
