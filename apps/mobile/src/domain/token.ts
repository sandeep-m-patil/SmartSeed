export type TokenParseResult = { ok: true; token: string } | { ok: false; reason: 'NOT_SMARTSEED' };

const TOKEN_PATTERN = '[A-Za-z0-9_-]{22,128}'; // >=128 bits when base64url (22 chars)
const URL_PATTERN = new RegExp(`^https://([A-Za-z0-9.-]+)(?::443)?/verify/(${TOKEN_PATTERN})/?$`);
const TOKEN_ONLY = new RegExp(`^${TOKEN_PATTERN}$`);
const DEFAULT_HOSTS = ['smartseed.example'];

export function allowedHosts(envValue: string | undefined = process.env.EXPO_PUBLIC_VERIFY_HOSTS): string[] {
  const hosts = (envValue ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : DEFAULT_HOSTS;
}

/**
 * Accepts only `https://<allowed host>/verify/<token>` (optional trailing slash).
 * Rejects credentials, other schemes/ports, query strings, fragments, extra path segments,
 * look-alike hosts and malformed tokens.
 */
export function parseScannedToken(raw: string, hosts: string[] = allowedHosts()): TokenParseResult {
  const match = URL_PATTERN.exec(raw.trim());
  const host = match?.[1]?.toLowerCase();
  const token = match?.[2];
  if (!match || !host || !token || !hosts.includes(host)) return { ok: false, reason: 'NOT_SMARTSEED' };
  return { ok: true, token };
}

export function isValidToken(token: string): boolean {
  return TOKEN_ONLY.test(token);
}
