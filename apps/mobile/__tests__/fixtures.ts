import type { VerifyResult } from '../src/domain/types';

export const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 chars, base64url

export const BATCH = { code: 'B-2026-001', mfgDate: '2026-01-10', expiryDate: '2099-01-10', expired: false };

export function makeResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    product: { name: 'Hybrid Cotton BG-II', brand: 'GreenGrow', cropType: 'Cotton', variety: 'GG-77' },
    manufacturer: { name: 'GreenGrow Seeds Pvt Ltd' },
    batch: BATCH,
    package: null,
    certifications: [{ type: 'ISTA', issuer: 'ISTA Lab', number: 'C-1', validTo: '2099-01-01' }],
    journey: [{ step: 'MANUFACTURED', orgType: 'manufacturer', at: '2026-01-10T00:00:00Z', status: 'CONFIRMED' }],
    verification: { digitalIdentity: 'VALID', blockchain: 'VERIFIED', scanActivity: 'NORMAL', investigation: 'NONE' },
    risk: { score: 5, level: 'LOW', assessed: true },
    indicator: 'GREEN',
    warnings: [],
    asOf: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

/** What the real backend returns for a token it does not know: HTTP 200, nulls, RED, QR_UNKNOWN. */
export function makeUnknownResult(): VerifyResult {
  return makeResult({
    product: null,
    manufacturer: null,
    batch: null,
    certifications: [],
    journey: [],
    verification: { digitalIdentity: 'UNKNOWN', blockchain: 'UNVERIFIED', scanActivity: 'NORMAL', investigation: 'NONE' },
    risk: { score: 0, level: 'LOW', assessed: false },
    indicator: 'RED',
    warnings: ['QR_UNKNOWN'],
  });
}

export function envelope(data: unknown) {
  return { data, meta: {}, error: null };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
