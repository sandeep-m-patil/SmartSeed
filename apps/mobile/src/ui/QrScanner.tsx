import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { parseScannedToken } from '../domain/token';
import { BigButton } from './BigButton';
import { Banner, Body, Screen, Title } from './Screen';

interface Props {
  onToken: (token: string) => void;
}

/** Camera QR scanner. Only `https://<allowed host>/verify/<token>` is accepted; anything else shows a friendly message. */
export function QrScanner({ onToken }: Props) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [hasInvalid, setHasInvalid] = useState(false);
  const isLocked = useRef(false); // camera fires repeatedly; handle one code at a time

  const handle = ({ data }: { data: string }) => {
    if (isLocked.current) return;
    const parsed = parseScannedToken(data);
    if (parsed.ok) {
      isLocked.current = true;
      onToken(parsed.token);
    } else {
      isLocked.current = true;
      setHasInvalid(true);
    }
  };

  const scanAgain = () => {
    isLocked.current = false;
    setHasInvalid(false);
  };

  if (!permission?.granted) {
    return (
      <Screen>
        <Title>{t('scanner.permissionTitle')}</Title>
        <Body>{t('scanner.permissionBody')}</Body>
        <BigButton label={t('scanner.grant')} onPress={() => void requestPermission()} testID="grant-camera" />
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      {hasInvalid ? (
        <Screen>
          <Banner message={t('scanner.notSmartSeed')} testID="invalid-qr" />
          <BigButton label={t('scanner.scanAgain')} onPress={scanAgain} testID="scan-again" />
        </Screen>
      ) : (
        <>
          <Body>{t('scanner.hint')}</Body>
          <CameraView
            style={styles.camera}
            facing="back"
            accessibilityLabel={t('a11y.scanFrame')}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handle}
            testID="camera"
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12, backgroundColor: '#FFFFFF' },
  camera: { flex: 1, borderRadius: 16, overflow: 'hidden' },
});
