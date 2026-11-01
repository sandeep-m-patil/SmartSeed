import type { Indicator, Risk, Verification } from './types';

const SEVERITY: Record<Indicator, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

/**
 * Safety rule (defence in depth, mirrors the server rule in docs/05-api-spec.md).
 * GREEN only when every check passes. Failed chain / revoked / confirmed counterfeit => RED.
 * Anything else is YELLOW, or RED when the risk level is HIGH/CRITICAL.
 */
export function deriveIndicator(verification: Verification, risk: Risk, expired: boolean): Indicator {
  if (
    verification.blockchain === 'FAILED' ||
    verification.investigation === 'CONFIRMED_COUNTERFEIT' ||
    verification.digitalIdentity === 'REVOKED'
  ) {
    return 'RED';
  }
  if (risk.level === 'HIGH' || risk.level === 'CRITICAL') return 'RED';
  const isAllClear =
    verification.digitalIdentity === 'VALID' &&
    verification.blockchain === 'VERIFIED' &&
    verification.scanActivity === 'NORMAL' &&
    verification.investigation === 'NONE' &&
    risk.level === 'LOW' &&
    !expired;
  return isAllClear ? 'GREEN' : 'YELLOW';
}

/** Never show something safer than either the server or the local derivation says. */
export function worstIndicator(a: Indicator, b: Indicator): Indicator {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}
