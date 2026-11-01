import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { journeyStatusKey, journeyStepKey, orgTypeKey } from '../src/domain/codes';
import { useCurrentView } from '../src/state/useCurrentView';
import { formatDate } from '../src/ui/format';
import { Banner, Body, Screen } from '../src/ui/Screen';
import { COLORS, FONT, SPACE } from '../src/ui/theme';

/** Screen 7: Supply Chain History. Server codes are mapped to localized labels; unknown codes get a generic label. */
export default function JourneyScreen() {
  const { t, i18n } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const view = useCurrentView(token);
  if (!view) return <Screen><Body>{t('common.loading')}</Body></Screen>;
  const { journey } = view.result;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('journey.title') }} />
      {view.isStale && <Banner message={t('verify.offlineBanner')} />}
      {journey.length === 0 && <Body muted>{t('journey.empty')}</Body>}
      {journey.map((step, i) => (
        <View key={`${step.step}-${i}`} style={styles.item}>
          <Text style={styles.step}>{`${i + 1}. ${t(journeyStepKey(step.step))}`}</Text>
          <Text style={styles.text}>{t(orgTypeKey(step.orgType))}</Text>
          <Text style={styles.text}>{`${formatDate(step.at, i18n.language)} · ${t(journeyStatusKey(step.status))}`}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { borderLeftWidth: 6, borderLeftColor: COLORS.primary, backgroundColor: COLORS.surface, padding: SPACE.md, gap: SPACE.xs, borderRadius: 8 },
  step: { fontSize: FONT.body, fontWeight: '800', color: COLORS.text },
  text: { fontSize: FONT.body, color: COLORS.textMuted },
});
