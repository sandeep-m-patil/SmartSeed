const MAX_TOKEN_LENGTH = 128;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Accepts either a raw QR token or the full verify URL printed in the QR (`https://host/verify/<token>`)
 * and returns the token, or null when the input cannot be a token.
 */
export function extractQrToken(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let candidate = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const fromQuery = url.searchParams.get('token') ?? url.searchParams.get('t');
      candidate = fromQuery ?? url.pathname.split('/').filter(Boolean).pop() ?? '';
    } catch {
      return null;
    }
  }
  return candidate.length > 0 && candidate.length <= MAX_TOKEN_LENGTH && TOKEN_PATTERN.test(candidate) ? candidate : null;
}
