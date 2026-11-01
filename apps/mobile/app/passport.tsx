import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useCurrentView } from '../src/state/useCurrentView';
import { formatDate } from '../src/ui/format';
import { Banner, Body, Screen, Title } from '../src/ui/Screen';
import { COLORS, FONT, SPACE } from '../src/ui/theme';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/** Screen 6: Digital Product Passport (simplified public view). */
export default function PassportScreen() {
  const { t, i18n } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const view = useCurrentView(token);
  if (!view) return <Screen><Body>{t('common.loading')}</Body></Screen>;
  const { product, manufacturer, batch, certifications, package: pkg } = view.result;
  const na = t('common.unknown');
  const date = (v: string) => formatDate(v, i18n.language);
  return (
    <Screen>
      <Stack.Screen options={{ title: t('passport.title') }} />
      {view.isStale && <Banner message={t('verify.offlineBanner')} />}
      <Title>{product?.name ?? na}</Title>
      <Field label={t('passport.brand')} value={product?.brand ?? na} />
      <Field label={t('passport.crop')} value={product?.cropType ?? na} />
      <Field label={t('passport.variety')} value={product?.variety ?? na} />
      <Field label={t('passport.manufacturer')} value={manufacturer?.name ?? na} />
      <Field label={t('passport.batch')} value={batch?.code ?? na} />
      {pkg && <Field label={t('passport.package')} value={pkg.serialNo} />}
      <Field label={t('passport.mfgDate')} value={batch ? date(batch.mfgDate) : na} />
      <Field label={t('passport.expiryDate')} value={!batch ? na : view.isExpired ? `${date(batch.expiryDate)} (${t('passport.expired')})` : date(batch.expiryDate)} />
      <Title>{t('passport.certifications')}</Title>
      {certifications.length === 0 && <Body muted>{t('passport.noCertifications')}</Body>}
      {certifications.map((c) => (
        <View key={`${c.type}-${c.number}`} style={styles.field}>
          <Text style={styles.value}>{c.type}</Text>
          <Text style={styles.label}>{t('passport.issuedBy', { issuer: c.issuer })}</Text>
          <Text style={styles.label}>{t('passport.number', { number: c.number })}</Text>
          <Text style={styles.label}>{c.validTo ? t('passport.validTo', { date: date(c.validTo) }) : na}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { borderWidth: 2, borderColor: COLORS.border, borderRadius: 12, padding: SPACE.md, gap: SPACE.xs },
  label: { fontSize: FONT.label, color: COLORS.textMuted, fontWeight: '700' },
  value: { fontSize: FONT.body, color: COLORS.text, fontWeight: '800' },
});
