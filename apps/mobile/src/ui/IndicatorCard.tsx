import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DisplayIndicator } from '../domain/types';
import { FONT, INDICATOR_COLORS, SPACE } from './theme';

interface Props {
  indicator: DisplayIndicator;
  /** Optional localized text overriding the default for this indicator (e.g. unrecognised code). */
  override?: { title: string; body: string };
}

export function IndicatorCard({ indicator, override }: Props) {
  const { t } = useTranslation();
  const colors = INDICATOR_COLORS[indicator];
  const title = override?.title ?? t(`indicator.${indicator}.title`);
  const body = override?.body ?? t(`indicator.${indicator}.body`);
  return (
    <View
      accessible
      accessibilityLabel={`${t('a11y.indicatorLabel', { title })}. ${body}`}
      style={[styles.card, { backgroundColor: colors.bg }]}
      testID={`indicator-${indicator}`}
    >
      <Text style={[styles.icon, { color: colors.fg }]}>{colors.icon}</Text>
      <Text style={[styles.title, { color: colors.fg }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.fg }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: SPACE.lg, gap: SPACE.sm, borderWidth: 2, borderColor: '#111827' },
  icon: { fontSize: 40, fontWeight: '900' },
  title: { fontSize: FONT.hero, fontWeight: '900' },
  body: { fontSize: FONT.body, lineHeight: FONT.body * 1.4 },
});
