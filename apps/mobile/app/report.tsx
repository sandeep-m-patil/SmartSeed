import React, { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isValidToken } from '../src/domain/token';
import { useSession } from '../src/state/session';
import { BigButton } from '../src/ui/BigButton';
import { Banner, Body, Screen } from '../src/ui/Screen';
import { COLORS, FONT, MIN_TOUCH_TARGET } from '../src/ui/theme';

type SendState = 'idle' | 'sending' | 'done' | 'failed';
const MAX_DESCRIPTION = 1000;
const MAX_REGION = 100;

/** Screen 9: Report Suspicious Product. Requires a scanned token (reached from a result screen). */
export default function ReportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { api } = useSession();
  const [description, setDescription] = useState('');
  const [region, setRegion] = useState('');
  const [state, setState] = useState<SendState>('idle');

  const send = async () => {
    if (!token) return;
    setState('sending');
    try {
      await api.report({
        token,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(region.trim() ? { region: region.trim() } : {}),
      });
      setState('done');
    } catch {
      setState('failed');
    }
  };

  if (!token || !isValidToken(token)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('report.title') }} />
        <Banner message={t('report.noToken')} />
        <BigButton label={t('home.scan')} onPress={() => router.replace('/scanner')} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: t('report.title') }} />
      <Body>{t('report.intro')}</Body>
      <Text style={styles.label}>{t('report.descriptionLabel')}</Text>
      <TextInput style={[styles.input, styles.multiline]} multiline maxLength={MAX_DESCRIPTION} value={description} onChangeText={setDescription} accessibilityLabel={t('report.descriptionLabel')} testID="report-description" />
      <Text style={styles.label}>{t('report.regionLabel')}</Text>
      <TextInput style={styles.input} maxLength={MAX_REGION} value={region} onChangeText={setRegion} accessibilityLabel={t('report.regionLabel')} />
      {state === 'done' && <Banner message={t('report.success')} testID="report-success" />}
      {state === 'failed' && <Banner message={t('report.failure')} testID="report-failure" />}
      <BigButton label={state === 'sending' ? t('report.sending') : t('report.submit')} disabled={state === 'sending' || state === 'done'} onPress={() => void send()} testID="report-submit" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FONT.body, fontWeight: '800', color: COLORS.text },
  input: { minHeight: MIN_TOUCH_TARGET, borderWidth: 2, borderColor: COLORS.border, borderRadius: 12, padding: 12, fontSize: FONT.body, color: COLORS.text, backgroundColor: COLORS.background },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
});
