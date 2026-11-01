import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { SessionProvider } from '../src/state/session';
import { COLORS } from '../src/ui/theme';

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: COLORS.background },
            headerTintColor: COLORS.text,
            headerTitleStyle: { fontSize: 20, fontWeight: '800' },
            contentStyle: { backgroundColor: COLORS.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
        </Stack>
      </SessionProvider>
    </I18nextProvider>
  );
}
