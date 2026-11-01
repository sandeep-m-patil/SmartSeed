import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { warningKey } from '../src/domain/codes';
import { useCurrentView } from '../src/state/useCurrentView';
import { IndicatorCard } from '../src/ui/IndicatorCard';
import { Banner, Body, Screen, Title } from '../src/ui/Screen';

/** Screen 8: Risk Status. Warning CODES are mapped to localized text. */
export default function RiskScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const view = useCurrentView(token);
  if (!view) return <Screen><Body>{t('common.loading')}</Body></Screen>;
  const { risk, warnings } = view.result;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('risk.title') }} />
      {view.isStale && <Banner message={t('verify.offlineBanner')} />}
      <IndicatorCard indicator={view.indicator} />
      {risk.assessed ? (
        <>
          <Title>{t(`risk.level.${risk.level}`)}</Title>
          <Body>{t('risk.score', { score: risk.score })}</Body>
          <Body>{t(`risk.explain.${risk.level}`)}</Body>
        </>
      ) : (
        <>
          <Title>{t('risk.notAssessedTitle')}</Title>
          <Body>{t('risk.notAssessedBody')}</Body>
        </>
      )}
      <Title>{t('risk.warnings')}</Title>
      {warnings.length === 0 && <Body muted>{t('risk.noWarnings')}</Body>}
      {warnings.map((w, i) => (
        <Body key={`${i}-${w}`}>{`• ${t(warningKey(w))}`}</Body>
      ))}
    </Screen>
  );
}
