import React, { useCallback, useEffect, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ApiErrorKind } from '../src/api/errors';
import { runVerification, type VerifyOutcome } from '../src/state/verifyFlow';
import { useSession } from '../src/state/session';
import { BigButton } from '../src/ui/BigButton';
import { ResultView } from '../src/ui/ResultView';
import { Banner, Body, Screen, Title } from '../src/ui/Screen';

const ERROR_KEYS: Record<ApiErrorKind, string> = {
  NETWORK: 'verify.errorNetwork',
  TIMEOUT: 'verify.errorTimeout',
  NOT_FOUND: 'verify.errorNotFound',
  RATE_LIMITED: 'verify.errorRateLimited',
  BAD_REQUEST: 'verify.errorGeneric',
  SERVER: 'verify.errorServer',
  INVALID_RESPONSE: 'verify.errorInvalid',
};

/** Screen 5: Product Verification. */
export default function VerifyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { api, store, setCurrent } = useSession();
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);

  const check = useCallback(async () => {
    if (!token) return;
    setOutcome(null);
    const result = await runVerification(token, { api, store });
    if (result.kind === 'fresh' || result.kind === 'offline') setCurrent({ token, view: result.view });
    setOutcome(result);
  }, [token, api, store, setCurrent]);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <>
      <Stack.Screen options={{ title: t('verify.title') }} />
      <VerifyBody outcome={outcome} token={token} onRetry={() => void check()} onReport={() => router.push({ pathname: '/report', params: { token } })} />
    </>
  );
}

interface BodyProps {
  outcome: VerifyOutcome | null;
  token: string | undefined;
  onRetry: () => void;
  onReport: () => void;
}

function VerifyBody({ outcome, token, onRetry, onReport }: BodyProps) {
  const { t } = useTranslation();
  if (!outcome || !token) {
    return (
      <Screen>
        <Title>{t('verify.checking')}</Title>
      </Screen>
    );
  }
  if (outcome.kind === 'fresh' || outcome.kind === 'offline') {
    return <ResultView token={token} view={outcome.view} onRecheck={onRetry} />;
  }
  const message = outcome.kind === 'offlineNoCopy' ? t('verify.noSavedCopy') : t(ERROR_KEYS[outcome.error]);
  const isNotFound = outcome.kind === 'error' && outcome.error === 'NOT_FOUND';
  return (
    <Screen>
      <Banner message={message} testID="verify-error" />
      <BigButton label={t('common.retry')} onPress={onRetry} />
      {isNotFound && <BigButton variant="secondary" label={t('verify.report')} onPress={onReport} />}
    </Screen>
  );
}
