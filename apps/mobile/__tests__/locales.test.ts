import { buildSpeechSummary } from '../src/domain/speech';
import { presentResult } from '../src/storage/cache';
import i18n from '../src/i18n';
import { LOCALES, SUPPORTED_LANGUAGES } from '../src/locales';
import { makeResult, makeUnknownResult } from './fixtures';
import { JOURNEY_STEPS, ORG_TYPES, WARNING_CODES, journeyStatusKey, journeyStepKey, orgTypeKey, warningKey } from '../src/domain/codes';

function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) return { [prefix]: obj };
  return Object.entries(obj).reduce<Record<string, unknown>>(
    (acc, [k, v]) => Object.assign(acc, flatten(v, prefix ? `${prefix}.${k}` : k)),
    {},
  );
}

const flat = Object.fromEntries(SUPPORTED_LANGUAGES.map((c) => [c, flatten(LOCALES[c])]));
const enKeys = Object.keys(flat.en ?? {}).sort();

describe('locale files', () => {
  it('registers en, te, hi', () => {
    expect(SUPPORTED_LANGUAGES.sort()).toEqual(['en', 'hi', 'te']);
  });

  it.each(SUPPORTED_LANGUAGES)('%s has exactly the same key set as en', (code) => {
    expect(Object.keys(flat[code] ?? {}).sort()).toEqual(enKeys);
  });

  it.each(SUPPORTED_LANGUAGES)('%s has no empty or non-string values', (code) => {
    for (const [key, value] of Object.entries(flat[code] ?? {})) {
      expect([key, typeof value === 'string' && value.trim().length > 0]).toEqual([key, true]);
    }
  });

  it.each(SUPPORTED_LANGUAGES)('%s keeps the same {{placeholders}} as en', (code) => {
    const placeholders = (s: unknown) => (String(s).match(/{{\w+}}/g) ?? []).sort().join(',');
    for (const key of enKeys) expect([key, placeholders(flat[code]?.[key])]).toEqual([key, placeholders(flat.en?.[key])]);
  });

  it('English copy never claims a packet is "genuine"/"authentic" from a code alone', () => {
    const claims = Object.entries(flat.en ?? {}).filter(([, v]) => /genuine|authentic/i.test(String(v)));
    expect(claims).toEqual([]);
  });
});

describe('spoken summary', () => {
  it.each(SUPPORTED_LANGUAGES)('is localized and complete in %s', async (code) => {
    await i18n.changeLanguage(code);
    const view = presentResult(makeResult(), { isCached: true, fetchedAt: 1, now: 2 });
    const text = buildSpeechSummary(i18n.t.bind(i18n), view);
    expect(text).toContain('Hybrid Cotton BG-II');
    expect(text).toContain(LOCALES[code].indicator.LAST_CHECKED.title);
    expect(text).toContain(LOCALES[code].tts.stale);
    expect(text).not.toMatch(/undefined|indicator\.|status\./);
  });
});

describe('warning / journey code localization', () => {
  const ALL_WARNINGS = [...WARNING_CODES, 'SOME_FUTURE_CODE'];

  it.each(SUPPORTED_LANGUAGES)('every warning code has localized text in %s (and future codes get the generic fallback)', async (code) => {
    await i18n.changeLanguage(code);
    const seen = new Set<string>();
    for (const w of WARNING_CODES) {
      const text = i18n.t(warningKey(w));
      expect(text).not.toBe(warningKey(w));
      expect(text).not.toContain(w);
      seen.add(text);
    }
    expect(seen.size).toBe(WARNING_CODES.length);
    const fallback = i18n.t(warningKey('SOME_FUTURE_CODE'));
    expect(fallback).toBe(LOCALES[code].warning.OTHER);
    expect(fallback).not.toContain('SOME_FUTURE_CODE');
    expect(ALL_WARNINGS).toHaveLength(WARNING_CODES.length + 1);
  });

  it.each(SUPPORTED_LANGUAGES)('journey steps and org types are localized in %s, unknowns are generic', async (code) => {
    await i18n.changeLanguage(code);
    for (const s of JOURNEY_STEPS) expect(i18n.t(journeyStepKey(s))).not.toContain(s);
    for (const o of ORG_TYPES) expect(i18n.t(orgTypeKey(o))).not.toBe(orgTypeKey(o));
    expect(i18n.t(journeyStepKey('NEW_STEP'))).toBe(LOCALES[code].journey.step.OTHER);
    expect(i18n.t(orgTypeKey('courier'))).toBe(LOCALES[code].journey.orgType.OTHER);
    expect(i18n.t(journeyStatusKey('PENDING'))).toBe(LOCALES[code].journey.status.OTHER);
  });

  it.each(SUPPORTED_LANGUAGES)('spoken summary uses the same localized warnings in %s and never raw codes', async (code) => {
    await i18n.changeLanguage(code);
    const r = makeResult({ warnings: ['CHAIN_NOT_YET_CONFIRMED', 'SOME_FUTURE_CODE'], risk: { score: 0, level: 'LOW', assessed: false } });
    const text = buildSpeechSummary(i18n.t.bind(i18n), presentResult(r, { isCached: false, fetchedAt: 1, now: 2 }));
    expect(text).toContain(i18n.t('warning.CHAIN_NOT_YET_CONFIRMED'));
    expect(text).toContain(i18n.t('warning.OTHER'));
    expect(text).toContain(i18n.t('risk.notAssessedTitle'));
    expect(text).not.toMatch(/CHAIN_NOT_YET_CONFIRMED|SOME_FUTURE_CODE/);
  });

  it.each(SUPPORTED_LANGUAGES)('unrecognised code is spoken as a localized "not recognised" message in %s', async (code) => {
    await i18n.changeLanguage(code);
    const text = buildSpeechSummary(i18n.t.bind(i18n), presentResult(makeUnknownResult(), { isCached: false, fetchedAt: 1, now: 2 }));
    expect(text).toContain(LOCALES[code].unknown.title);
    expect(text).not.toContain('QR_UNKNOWN');
  });
});
