import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BigButton } from '../src/ui/BigButton';
import { Body, Screen, Stack as VStack, Title } from '../src/ui/Screen';

/** Screen 3: Home. */
export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <Stack.Screen options={{ title: t('home.title'), headerBackVisible: false }} />
      <Title>{t('app.name')}</Title>
      <Body>{t('home.welcome')}</Body>
      <VStack>
        <BigButton label={t('home.scan')} onPress={() => router.push('/scanner')} testID="home-scan" />
        <BigButton variant="secondary" label={t('home.history')} onPress={() => router.push('/history')} />
        <BigButton variant="secondary" label={t('home.notifications')} onPress={() => router.push('/notifications')} />
        <BigButton variant="secondary" label={t('home.report')} onPress={() => router.push('/report')} />
        <BigButton variant="secondary" label={t('home.profile')} onPress={() => router.push('/profile')} />
      </VStack>
    </Screen>
  );
}
