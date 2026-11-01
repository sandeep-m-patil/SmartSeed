import en from './en.json';
import hi from './hi.json';
import te from './te.json';

/**
 * Language registry. To add a language: drop `<code>.json` (same keys as en.json, plus
 * meta.nativeName and meta.speechLocale) in this folder and add one line below.
 * The locale-parity test fails if the new file's keys differ from en.json.
 */
export const LOCALES = { en, te, hi } as const;

export type LanguageCode = keyof typeof LOCALES;
export const SUPPORTED_LANGUAGES = Object.keys(LOCALES) as LanguageCode[];
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function isSupportedLanguage(code: string | null | undefined): code is LanguageCode {
  return !!code && code in LOCALES;
}

export function speechLocaleFor(code: LanguageCode): string {
  return LOCALES[code].meta.speechLocale;
}
