import { RISK_META, normalizeRiskLevel, riskLevelFor, type RiskLevel } from '../lib/risk';

interface Props {
  /** Numeric 0-100 score; level is derived from it when `level` is not supplied. */
  score?: number | null;
  level?: string | null;
  showScore?: boolean;
}

function resolveLevel({ score, level }: Props): RiskLevel | null {
  const fromLevel = normalizeRiskLevel(level);
  if (fromLevel) return fromLevel;
  return typeof score === 'number' && Number.isFinite(score) ? riskLevelFor(score) : null;
}

/** Risk pill: icon + word + (optionally) score, so the level is readable without colour. */
export function RiskBadge(props: Props) {
  const level = resolveLevel(props);
  if (!level) {
    return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">Not assessed</span>;
  }
  const meta = RISK_META[level];
  const hasScore = props.showScore !== false && typeof props.score === 'number';
  return (
    <span
      data-risk-level={level}
      title={`${meta.label} risk (score ${meta.range})`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${meta.classes}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
      {hasScore && <span className="font-normal">({Math.round(props.score as number)})</span>}
    </span>
  );
}
