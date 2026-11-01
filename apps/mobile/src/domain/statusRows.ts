import type { Verification } from './types';

export type StatusLevel = 'ok' | 'warn' | 'bad' | 'neutral';
export type StatusKey = keyof Verification;

export interface StatusRowModel {
  key: StatusKey;
  value: string;
  level: StatusLevel;
}

const LEVELS: Record<string, StatusLevel> = {
  VALID: 'ok',
  UNKNOWN: 'warn',
  REVOKED: 'bad',
  VERIFIED: 'ok',
  UNVERIFIED: 'warn',
  FAILED: 'bad',
  NORMAL: 'ok',
  SUSPICIOUS: 'warn',
  NONE: 'ok',
  UNDER_INVESTIGATION: 'warn',
  CONFIRMED_COUNTERFEIT: 'bad',
};

const ORDER: StatusKey[] = ['digitalIdentity', 'blockchain', 'scanActivity', 'investigation'];

/** The four independent statuses, always shown separately. Stale "ok" values are neutral, never green. */
export function buildStatusRows(verification: Verification, isStale: boolean): StatusRowModel[] {
  return ORDER.map((key) => {
    const value = verification[key];
    const level = LEVELS[value] ?? 'warn';
    return { key, value, level: isStale && level === 'ok' ? 'neutral' : level };
  });
}
