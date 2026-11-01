import { deriveIndicator, worstIndicator } from '../src/domain/indicator';
import type { BlockchainStatus, DigitalIdentity, Investigation, RiskLevel, ScanActivity, Verification } from '../src/domain/types';

const IDENTITIES: DigitalIdentity[] = ['VALID', 'REVOKED', 'UNKNOWN'];
const CHAINS: BlockchainStatus[] = ['VERIFIED', 'UNVERIFIED', 'FAILED'];
const SCANS: ScanActivity[] = ['NORMAL', 'SUSPICIOUS'];
const INVESTIGATIONS: Investigation[] = ['NONE', 'UNDER_INVESTIGATION', 'CONFIRMED_COUNTERFEIT'];
const LEVELS: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const good: Verification = { digitalIdentity: 'VALID', blockchain: 'VERIFIED', scanActivity: 'NORMAL', investigation: 'NONE' };
const low = { score: 1, level: 'LOW' as const, assessed: true };

describe('deriveIndicator truth table', () => {
  it('is GREEN when every check passes', () => {
    expect(deriveIndicator(good, low, false)).toBe('GREEN');
  });

  it.each([
    ['identity UNKNOWN', { digitalIdentity: 'UNKNOWN' as const }, 'YELLOW'],
    ['chain UNVERIFIED', { blockchain: 'UNVERIFIED' as const }, 'YELLOW'],
    ['scan SUSPICIOUS', { scanActivity: 'SUSPICIOUS' as const }, 'YELLOW'],
    ['under investigation', { investigation: 'UNDER_INVESTIGATION' as const }, 'YELLOW'],
    ['chain FAILED', { blockchain: 'FAILED' as const }, 'RED'],
    ['identity REVOKED', { digitalIdentity: 'REVOKED' as const }, 'RED'],
    ['confirmed counterfeit', { investigation: 'CONFIRMED_COUNTERFEIT' as const }, 'RED'],
  ])('%s -> %s', (_name, patch, expected) => {
    expect(deriveIndicator({ ...good, ...patch }, low, false)).toBe(expected);
  });

  it('expired batch is never GREEN', () => {
    expect(deriveIndicator(good, low, true)).toBe('YELLOW');
  });

  it.each([
    ['MEDIUM', 'YELLOW'],
    ['HIGH', 'RED'],
    ['CRITICAL', 'RED'],
  ] as const)('risk %s with all checks passing -> %s', (level, expected) => {
    expect(deriveIndicator(good, { score: 50, level, assessed: true }, false)).toBe(expected);
  });

  it('exhaustive: GREEN iff all checks pass; hard failures always RED', () => {
    let greens = 0;
    for (const digitalIdentity of IDENTITIES)
      for (const blockchain of CHAINS)
        for (const scanActivity of SCANS)
          for (const investigation of INVESTIGATIONS)
            for (const level of LEVELS)
              for (const expired of [false, true]) {
                const v = { digitalIdentity, blockchain, scanActivity, investigation };
                const out = deriveIndicator(v, { score: 0, level, assessed: true }, expired);
                const isAllClear =
                  digitalIdentity === 'VALID' && blockchain === 'VERIFIED' && scanActivity === 'NORMAL' &&
                  investigation === 'NONE' && level === 'LOW' && !expired;
                expect(out === 'GREEN').toBe(isAllClear);
                const isHardFail = blockchain === 'FAILED' || investigation === 'CONFIRMED_COUNTERFEIT' || digitalIdentity === 'REVOKED';
                if (isHardFail) expect(out).toBe('RED');
                if (isAllClear) greens++;
              }
    expect(greens).toBe(1);
  });
});

describe('worstIndicator', () => {
  it('never returns something safer than either input', () => {
    expect(worstIndicator('GREEN', 'RED')).toBe('RED');
    expect(worstIndicator('YELLOW', 'GREEN')).toBe('YELLOW');
    expect(worstIndicator('GREEN', 'GREEN')).toBe('GREEN');
  });
});
