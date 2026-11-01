import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import type { ApiClient } from '../api/client';
import type { KeyValueStore } from '../storage/kv';
import { DEVICE_REGISTERED_KEY, PUSH_TOKEN_KEY, getOrCreateDeviceId, getStoredLanguage } from './device';
import { DEFAULT_LANGUAGE } from '../locales';

export type PushResult = 'granted' | 'denied' | 'unavailable';

interface Deps {
  api: Pick<ApiClient, 'registerDevice'>;
  store: KeyValueStore;
}

/** Asks permission, gets an Expo push token, stores it and re-registers the anonymous device. */
export async function enablePushAlerts({ api, store }: Deps): Promise<PushResult> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return 'denied';
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId;
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await store.setItem(PUSH_TOKEN_KEY, pushToken);
    const deviceId = await getOrCreateDeviceId(store);
    const language = (await getStoredLanguage(store)) ?? DEFAULT_LANGUAGE;
    await api.registerDevice({ deviceId, pushToken, language });
    await store.setItem(DEVICE_REGISTERED_KEY, '1');
    return 'granted';
  } catch {
    return 'unavailable';
  }
}
