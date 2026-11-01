import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { QrScanner } from '../src/ui/QrScanner';

/** Screen 4: QR Scanner. */
export default function ScannerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: t('scanner.title') }} />
      <QrScanner onToken={(token) => router.replace({ pathname: '/verify', params: { token } })} />
    </>
  );
}
