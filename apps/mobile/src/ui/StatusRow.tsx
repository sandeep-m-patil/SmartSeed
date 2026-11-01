import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StatusRowModel } from '../domain/statusRows';
import { COLORS, FONT, LEVEL_COLORS, SPACE } from './theme';

/** One of the four independent statuses with a plain-language explanation (never colour-only). */
export function StatusRow({ row }: { row: StatusRowModel }) {
  const { t } = useTranslation();
  const colors = LEVEL_COLORS[row.level];
  const levelLabel = row.level === 'neutral' ? t('indicator.LAST_CHECKED.title') : t(`level.${row.level}`);
  return (
    <View style={styles.card} accessible accessibilityLabel={`${t(`status.${row.key}.name`)}. ${levelLabel}. ${t(`status.${row.key}.${row.value}`)}`}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: colors.bg }]}>
          <Text style={[styles.badgeText, { color: colors.fg }]}>{`${colors.icon} ${levelLabel}`}</Text>
        </View>
        <Text style={styles.name}>{t(`status.${row.key}.name`)}</Text>
      </View>
      <Text style={styles.explain}>{t(`status.${row.key}.${row.value}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderColor: COLORS.border, borderRadius: 12, padding: SPACE.md, gap: SPACE.xs },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm },
  badge: { borderRadius: 8, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs },
  badgeText: { fontSize: FONT.label, fontWeight: '800' },
  name: { fontSize: FONT.body, fontWeight: '800', color: COLORS.text },
  explain: { fontSize: FONT.body, color: COLORS.text, lineHeight: FONT.body * 1.4 },
});
