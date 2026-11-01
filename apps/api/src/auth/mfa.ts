import { authenticator } from 'otplib';

const STEP_SECONDS = 30;
const ISSUER = 'SmartSeed';

authenticator.options = { window: 1, step: STEP_SECONDS };

export const generateMfaSecret = (): string => authenticator.generateSecret();

export const otpauthUrl = (email: string, secret: string): string => authenticator.keyuri(email, ISSUER, secret);

/**
 * Returns the matched time-step or null. Callers must reject steps <= the
 * user's stored last step so a captured code cannot be replayed.
 */
export function matchStep(code: string, secret: string, nowMs = Date.now()): number | null {
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  return Math.floor(nowMs / 1000 / STEP_SECONDS) + delta;
}
