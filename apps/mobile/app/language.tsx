import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '../src/i18n';
import { LOCALES, SUPPORTED_LANGUAGES, type LanguageCode } from '../src/locales';
import { ensureDeviceRegistered, setStoredLanguage } from '../src/state/device';
import { useSession } from '../src/state/session';
import { BigButton } from '../src/ui/BigButton';
import { Body, Screen, Stack as VStack, Title } from '../src/ui/Screen';

/** Screen 2: Language Selection (also reachable from Profile). Each button is labelled in its own language. */
export default function LanguageScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, store } = useSession();

  const choose = async (code: LanguageCode) => {
    await setStoredLanguage(store, code);
    await i18n.changeLanguage(code);
    void ensureDeviceRegistered(code, { api, store });
    router.replace('/home');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('language.title') }} />
      <Title>{t('language.title')}</Title>
      <Body muted>{t('language.subtitle')}</Body>
      <VStack>
        {SUPPORTED_LANGUAGES.map((code) => (
          <BigButton key={code} label={LOCALES[code].meta.nativeName} onPress={() => void choose(code)} testID={`lang-${code}`} />
        ))}
      </VStack>
    </Screen>
  );
}
