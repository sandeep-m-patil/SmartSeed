import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { AppNotification } from '../src/api/schemas';
import { getOrCreateDeviceId } from '../src/state/device';
import { enablePushAlerts, type PushResult } from '../src/state/push';
import { useSession } from '../src/state/session';
import { BigButton } from '../src/ui/BigButton';
import { formatDate } from '../src/ui/format';
import { Banner, Body, Screen } from '../src/ui/Screen';
import { COLORS, FONT, SPACE } from '../src/ui/theme';

/** Screen 11: Notifications (server alerts for this anonymous device + push opt-in). */
export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const { api, store } = useSession();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [hasError, setHasError] = useState(false);
  const [push, setPush] = useState<PushResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          setItems(await api.notifications(await getOrCreateDeviceId(store)));
          setHasError(false);
        } catch {
          setHasError(true);
        }
      })();
    }, [api, store]),
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('notifications.title') }} />
      {hasError && <Banner message={t('notifications.error')} />}
      {push === 'granted' && <Body>{t('notifications.enabled')}</Body>}
      {push === 'denied' && <Banner message={t('notifications.denied')} />}
      {push !== 'granted' && <BigButton label={t('notifications.enable')} onPress={() => void enablePushAlerts({ api, store }).then(setPush)} />}
      {!hasError && items.length === 0 && <Body muted>{t('notifications.empty')}</Body>}
      {items.map((n) => (
        <View key={n.id} style={styles.item}>
          <Text style={styles.title}>{n.title}</Text>
          <Text style={styles.body}>{n.body}</Text>
          <Text style={styles.meta}>{formatDate(n.createdAt, i18n.language)}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 2, borderColor: COLORS.border, borderRadius: 12, padding: SPACE.md, gap: SPACE.xs },
  title: { fontSize: FONT.body, fontWeight: '800', color: COLORS.text },
  body: { fontSize: FONT.body, color: COLORS.text },
  meta: { fontSize: FONT.label, color: COLORS.textMuted },
});
