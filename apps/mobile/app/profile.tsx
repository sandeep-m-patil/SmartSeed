import React, { useEffect, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { LOCALES, isSupportedLanguage } from '../src/locales';
import { getOrCreateDeviceId } from '../src/state/device';
import { useSession } from '../src/state/session';
import { BigButton } from '../src/ui/BigButton';
import { Body, Screen, Title } from '../src/ui/Screen';

/** Screen 12: Profile (anonymous device id, language, version). No personal data is collected. */
export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { store } = useSession();
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void getOrCreateDeviceId(store).then(setDeviceId);
  }, [store]);

  const languageName = isSupportedLanguage(i18n.language) ? LOCALES[i18n.language].meta.nativeName : i18n.language;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('profile.title') }} />
      <Title>{t('profile.deviceId')}</Title>
      <Body>{deviceId}</Body>
      <Body muted>{t('profile.deviceHint')}</Body>
      <Title>{t('profile.language')}</Title>
      <Body>{languageName}</Body>
      <BigButton variant="secondary" label={t('profile.language')} onPress={() => router.push('/language')} />
      <Body muted>{t('profile.version', { version: Constants.expoConfig?.version ?? '0.1.0' })}</Body>
    </Screen>
  );
}
