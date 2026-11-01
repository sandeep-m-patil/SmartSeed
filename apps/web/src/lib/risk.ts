export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const RISK_LEVELS: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const MEDIUM_MIN = 25;
const HIGH_MIN = 50;
const CRITICAL_MIN = 75;
const MAX_SCORE = 100;

export interface RiskMeta {
  label: string;
  range: string;
  /** Tailwind classes; colour is never the only signal - the label and icon always accompany it. */
  classes: string;
  icon: string;
  chart: string;
}

export const RISK_META: Record<RiskLevel, RiskMeta> = {
  LOW: { label: 'Low', range: '0-24', icon: '✓', classes: 'bg-green-50 text-green-800 ring-green-600/30', chart: '#16a34a' },
  MEDIUM: { label: 'Medium', range: '25-49', icon: '▲', classes: 'bg-yellow-50 text-yellow-900 ring-yellow-600/40', chart: '#ca8a04' },
  HIGH: { label: 'High', range: '50-74', icon: '▲▲', classes: 'bg-orange-50 text-orange-900 ring-orange-600/40', chart: '#ea580c' },
  CRITICAL: { label: 'Critical', range: '75-100', icon: '⛔', classes: 'bg-red-50 text-red-900 ring-red-600/50', chart: '#dc2626' },
};

/** Maps a 0-100 risk score to its level. Throws for non-numeric input so a bad value is never shown as "Low". */
export function riskLevelFor(score: number): RiskLevel {
  if (!Number.isFinite(score)) throw new RangeError('Risk score must be a finite number');
  const clamped = Math.min(MAX_SCORE, Math.max(0, score));
  if (clamped >= CRITICAL_MIN) return 'CRITICAL';
  if (clamped >= HIGH_MIN) return 'HIGH';
  if (clamped >= MEDIUM_MIN) return 'MEDIUM';
  return 'LOW';
}

/** Normalises API severity strings ("high", "HIGH", "Critical") to a level, or null when unknown. */
export function normalizeRiskLevel(value: string | null | undefined): RiskLevel | null {
  const upper = value?.trim().toUpperCase();
  return RISK_LEVELS.find((l) => l === upper) ?? null;
}
