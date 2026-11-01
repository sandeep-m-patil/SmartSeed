import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { DEFAULT_LANGUAGE, LOCALES, isSupportedLanguage, type LanguageCode } from '../locales';

const resources = Object.fromEntries(
  Object.entries(LOCALES).map(([code, translation]) => [code, { translation }]),
);

export function detectDeviceLanguage(): LanguageCode {
  const code = getLocales()[0]?.languageCode;
  return isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export default i18n;
