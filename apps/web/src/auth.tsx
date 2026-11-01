import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';

interface Session {
  accessToken: string;
  refreshToken: string;
}

export type LoginStep =
  | { kind: 'credentials' }
  | { kind: 'mfa'; mfaToken: string; enrollment: { secret: string; otpauthUrl: string } | null };

interface AuthState {
  accessToken: string | null;
  step: LoginStep;
  signIn(email: string, password: string): Promise<void>;
  submitCode(code: string): Promise<void>;
  signOut(): Promise<void>;
  /** Current in-memory token (always fresh, unlike the state snapshot captured by a closure). */
  getAccessToken(): string | null;
  /** Rotates the refresh token once even when many requests hit 401 together; resolves the new token or null. */
  refreshSession(): Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse extends Partial<Session> {
  mfaRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
  mfaToken?: string;
}

/**
 * Tokens live only in memory (cleared on reload) so no credential is reachable
 * from web storage. A cookie-based refresh flow arrives with the production web release.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState<LoginStep>({ kind: 'credentials' });
  const sessionRef = useRef<Session | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);

  const apply = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api<LoginResponse>('/v1/auth/login', { method: 'POST', body: { email, password } });
    if (res.accessToken && res.refreshToken) {
      apply({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      return;
    }
    const mfaToken = res.mfaToken as string;
    const enrollment = res.mfaEnrollmentRequired
      ? await api<{ secret: string; otpauthUrl: string }>('/v1/auth/mfa/enroll', { method: 'POST', body: { mfaToken } })
      : null;
    setStep({ kind: 'mfa', mfaToken, enrollment });
  }, [apply]);

  const submitCode = useCallback(
    async (code: string) => {
      if (step.kind !== 'mfa') return;
      const res = await api<Session>('/v1/auth/mfa/verify', { method: 'POST', body: { mfaToken: step.mfaToken, code } });
      apply(res);
      setStep({ kind: 'credentials' });
    },
    [step, apply],
  );

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    if (current) await api('/v1/auth/logout', { method: 'POST', body: { refreshToken: current.refreshToken } }).catch(() => undefined);
    apply(null);
    setStep({ kind: 'credentials' });
  }, [apply]);

  const refreshSession = useCallback((): Promise<string | null> => {
    if (refreshing.current) return refreshing.current;
    const current = sessionRef.current;
    if (!current) return Promise.resolve(null);
    refreshing.current = api<Session>('/v1/auth/refresh', { method: 'POST', body: { refreshToken: current.refreshToken } })
      .then((next) => {
        apply(next);
        return next.accessToken;
      })
      .catch(() => {
        apply(null);
        return null;
      })
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
  }, [apply]);

  const getAccessToken = useCallback(() => sessionRef.current?.accessToken ?? null, []);

  const value = useMemo(
    () => ({ accessToken: session?.accessToken ?? null, step, signIn, submitCode, signOut, getAccessToken, refreshSession }),
    [session, step, signIn, submitCode, signOut, getAccessToken, refreshSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
