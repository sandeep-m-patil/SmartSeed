import React, { useEffect, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';
import { buildSpeechSummary } from '../domain/speech';
import { buildStatusRows } from '../domain/statusRows';
import { speechLocaleFor, isSupportedLanguage, DEFAULT_LANGUAGE } from '../locales';
import type { Presentation } from '../storage/cache';
import { BigButton } from './BigButton';
import { formatDate } from './format';
import { IndicatorCard } from './IndicatorCard';
import { Banner, Body, Screen, Stack as VStack, Title } from './Screen';
import { StatusRow } from './StatusRow';

interface Props {
  token: string;
  view: Presentation;
  onRecheck: () => void;
}

/** Product Verification result: verdict, four separate statuses, TTS, links to detail screens. */
export function ResultView({ token, view, onRecheck }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const go = (pathname: string) => router.push({ pathname, params: { token } } as Href);

  useEffect(() => () => void Speech.stop(), []);

  const toggleSpeech = () => {
    if (isSpeaking) {
      void Speech.stop();
      setIsSpeaking(false);
      return;
    }
    const lang = isSupportedLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
    setIsSpeaking(true);
    Speech.speak(buildSpeechSummary(t, view), {
      language: speechLocaleFor(lang),
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  };

  const date = formatDate(view.fetchedAt, i18n.language);
  if (view.isUnrecognised) {
    return (
      <Screen>
        <IndicatorCard indicator="RED" override={{ title: t('unknown.title'), body: t('unknown.body') }} />
        <BigButton label={t('verify.report')} onPress={() => go('/report')} testID="report-unknown" />
        <BigButton variant="secondary" label={t('scanner.scanAgain')} onPress={() => router.replace('/scanner')} />
      </Screen>
    );
  }
  return (
    <Screen>
      {view.isStale && <Banner message={t('verify.offlineBanner')} testID="offline-banner" />}
      <IndicatorCard indicator={view.indicator} />
      <Body muted>{view.isStale ? t('verify.savedOn', { date }) : t('verify.checkedOn', { date })}</Body>
      <Title>{view.result.product?.name ?? t('common.unknown')}</Title>
      {view.isExpired && <Banner message={t('verify.expiredWarning')} testID="expired-banner" />}
      <VStack>
        {buildStatusRows(view.result.verification, view.isStale).map((row) => (
          <StatusRow key={row.key} row={row} />
        ))}
      </VStack>
      {view.isStale && <BigButton label={t('verify.recheck')} onPress={onRecheck} testID="recheck" />}
      <BigButton
        variant={view.isStale ? 'secondary' : 'primary'}
        label={isSpeaking ? t('verify.stopListening') : t('verify.listen')}
        onPress={toggleSpeech}
        testID="listen"
      />
      <BigButton variant="secondary" label={t('verify.viewPassport')} onPress={() => go('/passport')} />
      <BigButton variant="secondary" label={t('verify.viewJourney')} onPress={() => go('/journey')} />
      <BigButton variant="secondary" label={t('verify.viewRisk')} onPress={() => go('/risk')} />
      <BigButton variant="secondary" label={t('verify.report')} onPress={() => go('/report')} />
    </Screen>
  );
}
