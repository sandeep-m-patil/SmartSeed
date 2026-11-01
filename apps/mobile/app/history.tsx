import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry } from '../src/domain/types';
import { useSession } from '../src/state/session';
import { clearHistory, loadHistory } from '../src/storage/history';
import { BigButton } from '../src/ui/BigButton';
import { formatDate } from '../src/ui/format';
import { Body, Screen } from '../src/ui/Screen';
import { COLORS, FONT, SPACE } from '../src/ui/theme';

/** Screen 10: Verification History (local only; deliberately shows no safety verdict). */
export default function HistoryScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { store } = useSession();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory(store).then(setEntries);
    }, [store]),
  );

  const clear = async () => {
    await clearHistory(store);
    setEntries([]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('history.title') }} />
      {entries.length === 0 && <Body muted>{t('history.empty')}</Body>}
      {entries.map((e) => (
        <View key={e.token} style={styles.item}>
          <Text style={styles.name}>{e.productName}</Text>
          <Text style={styles.meta}>{`${t('history.batch', { code: e.batchCode })} · ${formatDate(e.checkedAt, i18n.language)}`}</Text>
          <BigButton variant="secondary" label={t('history.open')} onPress={() => router.push({ pathname: '/verify', params: { token: e.token } })} />
        </View>
      ))}
      {entries.length > 0 && <BigButton variant="secondary" label={t('history.clear')} onPress={() => void clear()} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 2, borderColor: COLORS.border, borderRadius: 12, padding: SPACE.md, gap: SPACE.sm },
  name: { fontSize: FONT.body, fontWeight: '800', color: COLORS.text },
  meta: { fontSize: FONT.label, color: COLORS.textMuted },
});
