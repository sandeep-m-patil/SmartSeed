import { describe, expect, it } from 'vitest';
import { normalizeRiskLevel, riskLevelFor } from './risk';

describe('riskLevelFor', () => {
  it.each([
    [0, 'LOW'], [24, 'LOW'], [24.9, 'LOW'],
    [25, 'MEDIUM'], [49, 'MEDIUM'],
    [50, 'HIGH'], [74, 'HIGH'],
    [75, 'CRITICAL'], [100, 'CRITICAL'],
  ])('maps score %s to %s', (score, level) => {
    expect(riskLevelFor(score)).toBe(level);
  });

  it('clamps out-of-range scores instead of throwing', () => {
    expect(riskLevelFor(-5)).toBe('LOW');
    expect(riskLevelFor(250)).toBe('CRITICAL');
  });

  it('rejects non-finite input so an invalid score is never shown as Low', () => {
    expect(() => riskLevelFor(Number.NaN)).toThrow(RangeError);
    expect(() => riskLevelFor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('normalizeRiskLevel', () => {
  it('is case-insensitive and trims', () => {
    expect(normalizeRiskLevel(' high ')).toBe('HIGH');
    expect(normalizeRiskLevel('Critical')).toBe('CRITICAL');
  });

  it('returns null for unknown or missing values', () => {
    expect(normalizeRiskLevel('severe')).toBeNull();
    expect(normalizeRiskLevel(null)).toBeNull();
    expect(normalizeRiskLevel(undefined)).toBeNull();
  });
});
