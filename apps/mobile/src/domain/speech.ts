import type { Presentation } from '../storage/cache';
import { warningKey } from './codes';
import { buildStatusRows } from './statusRows';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Localized spoken summary: verdict first, then each of the four statuses, then expiry. */
export function buildSpeechSummary(t: Translate, view: Presentation): string {
  const { result } = view;
  if (view.isUnrecognised) return [t('unknown.title'), t('unknown.body')].join(' ');
  const parts = [
    t('tts.intro', { product: result.product?.name ?? t('common.unknown'), batch: result.batch?.code ?? t('common.unknown') }),
    t(`indicator.${view.indicator}.title`),
    t(`indicator.${view.indicator}.body`),
  ];
  if (view.isStale) parts.push(t('tts.stale'));
  for (const row of buildStatusRows(result.verification, view.isStale)) {
    parts.push(t(`status.${row.key}.${row.value}`));
  }
  if (view.isExpired) parts.push(t('tts.expired'));
  if (!result.risk.assessed) parts.push(t('risk.notAssessedTitle'));
  for (const code of result.warnings) parts.push(t(warningKey(code)));
  return parts.join(' ');
}
