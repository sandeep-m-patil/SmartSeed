import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { apiBaseUrl, createApiClient, type ApiClient } from '../api/client';
import type { Presentation } from '../storage/cache';
import { getOrCreateDeviceId } from './device';
import { appStorage, type KeyValueStore } from '../storage/kv';

interface Session {
  api: ApiClient;
  store: KeyValueStore;
  /** The result currently being viewed; sub-screens (passport, journey, risk) read it. */
  current: { token: string; view: Presentation } | null;
  setCurrent: (value: { token: string; view: Presentation } | null) => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Session['current']>(null);
  const api = useMemo(() => createApiClient({ baseUrl: apiBaseUrl(), getDeviceId: () => getOrCreateDeviceId(appStorage) }), []);
  const value = useMemo<Session>(() => ({ api, store: appStorage, current, setCurrent }), [api, current]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
