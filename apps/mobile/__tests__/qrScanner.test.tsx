import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { QrScanner } from '../src/ui/QrScanner';
import { TOKEN } from './fixtures';

jest.setTimeout(30000); // first render in a cold jest-expo worker is slow

type ScanHandler = (e: { data: string }) => void;
let lastHandler: ScanHandler | undefined;

jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  return {
    CameraView: (props: { onBarcodeScanned: ScanHandler; testID?: string }) => {
      lastHandler = props.onBarcodeScanned;
      return <View testID={props.testID} />;
    },
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

async function setup() {
  const onToken = jest.fn();
  await render(
    <I18nextProvider i18n={i18n}>
      <QrScanner onToken={onToken} />
    </I18nextProvider>,
  );
  return onToken;
}

beforeEach(async () => {
  lastHandler = undefined;
  await i18n.changeLanguage('en');
});

describe('QrScanner invalid QR handling', () => {
  it('shows a friendly message and does not navigate for a non-SmartSeed QR', async () => {
    const onToken = await setup();
    await act(async () => lastHandler?.({ data: 'https://evil.example/verify/' + TOKEN }));
    expect(screen.getByTestId('invalid-qr')).toBeTruthy();
    expect(screen.getByText(/not a SmartSeed code/i)).toBeTruthy();
    expect(onToken).not.toHaveBeenCalled();
  });

  it('ignores repeated frames of the same bad code (handled once)', async () => {
    const onToken = await setup();
    await act(async () => lastHandler?.({ data: 'upi://pay?pa=x@y' }));
    await act(async () => lastHandler?.({ data: `https://smartseed.example/verify/${TOKEN}` }));
    expect(onToken).not.toHaveBeenCalled();
  });

  it('can scan again after an invalid code', async () => {
    await setup();
    await act(async () => lastHandler?.({ data: 'garbage' }));
    await fireEvent.press(screen.getByTestId('scan-again'));
    expect(screen.getByTestId('camera')).toBeTruthy();
  });

  it('forwards the token for a valid SmartSeed URL, once', async () => {
    const onToken = await setup();
    await act(async () => lastHandler?.({ data: `https://smartseed.example/verify/${TOKEN}` }));
    await act(async () => lastHandler?.({ data: `https://smartseed.example/verify/${TOKEN}` }));
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith(TOKEN);
  });
});
