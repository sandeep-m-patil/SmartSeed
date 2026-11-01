import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n, { detectDeviceLanguage } from '../src/i18n';
import { ensureDeviceRegistered, getStoredLanguage } from '../src/state/device';
import { useSession } from '../src/state/session';
import { COLORS, FONT } from '../src/ui/theme';

const MIN_SPLASH_MS = 1200;

/** Screen 1: Splash. Loads language, ensures the anonymous device exists, then routes. */
export default function Splash() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, store } = useSession();

  useEffect(() => {
    let isActive = true;
    (async () => {
      const started = Date.now();
      const stored = await getStoredLanguage(store);
      await i18n.changeLanguage(stored ?? detectDeviceLanguage());
      void ensureDeviceRegistered(stored ?? detectDeviceLanguage(), { api, store });
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_SPLASH_MS - (Date.now() - started))));
      if (isActive) router.replace(stored ? '/home' : '/language');
    })();
    return () => {
      isActive = false;
    };
  }, [api, store, router]);

  return (
    <View style={styles.root}>
      <Text style={styles.name}>{t('app.name')}</Text>
      <Text style={styles.tagline}>{t('app.tagline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  name: { color: COLORS.onPrimary, fontSize: 40, fontWeight: '900' },
  tagline: { color: COLORS.onPrimary, fontSize: FONT.body, textAlign: 'center' },
});
