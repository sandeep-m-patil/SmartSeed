/** Locale-aware short date. Accepts epoch ms or ISO string; returns the raw input if unparseable. */
export function formatDate(value: number | string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
