import { randomUUID } from 'expo-crypto';
import type { ApiClient } from '../api/client';
import { isSupportedLanguage, type LanguageCode } from '../locales';
import type { KeyValueStore } from '../storage/kv';

export const DEVICE_ID_KEY = 'smartseed.deviceId.v1';
export const DEVICE_REGISTERED_KEY = 'smartseed.deviceRegistered.v1';
export const LANGUAGE_KEY = 'smartseed.language.v1';
export const PUSH_TOKEN_KEY = 'smartseed.pushToken.v1';

export async function getStoredLanguage(store: KeyValueStore): Promise<LanguageCode | null> {
  const code = await store.getItem(LANGUAGE_KEY);
  return isSupportedLanguage(code) ? code : null;
}

export async function setStoredLanguage(store: KeyValueStore, code: LanguageCode): Promise<void> {
  await store.setItem(LANGUAGE_KEY, code);
  await store.removeItem(DEVICE_REGISTERED_KEY); // re-sync language to the server next time
}

/** Anonymous device id: random UUID created once, kept locally. No personal data. */
export async function getOrCreateDeviceId(store: KeyValueStore): Promise<string> {
  const existing = await store.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await store.setItem(DEVICE_ID_KEY, id);
  return id;
}

export interface RegisterDeps {
  api: Pick<ApiClient, 'registerDevice'>;
  store: KeyValueStore;
}

/** Best-effort registration; failure is silent and retried on the next app start. */
export async function ensureDeviceRegistered(language: LanguageCode, deps: RegisterDeps): Promise<string> {
  const deviceId = await getOrCreateDeviceId(deps.store);
  if (await deps.store.getItem(DEVICE_REGISTERED_KEY)) return deviceId;
  try {
    const pushToken = (await deps.store.getItem(PUSH_TOKEN_KEY)) ?? undefined;
    await deps.api.registerDevice({ deviceId, language, ...(pushToken ? { pushToken } : {}) });
    await deps.store.setItem(DEVICE_REGISTERED_KEY, '1');
  } catch {
    /* offline or server down: app works anonymously without registration */
  }
  return deviceId;
}
