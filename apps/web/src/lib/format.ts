import { EXPIRY_WARNING_DAYS, MS_PER_DAY, SHORT_ID_LENGTH } from './constants';

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const formatNumber = (n: number | null | undefined): string => (n == null ? '-' : n.toLocaleString());

export const shortId = (id: string | null | undefined): string => (id ? `${id.slice(0, SHORT_ID_LENGTH)}…` : '-');

export const titleCase = (s: string): string => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function daysUntil(isoDate: string, now: Date = new Date()): number {
  return Math.ceil((new Date(isoDate).getTime() - now.getTime()) / MS_PER_DAY);
}

export function isExpiringSoon(isoDate: string, now: Date = new Date()): boolean {
  const d = daysUntil(isoDate, now);
  return d >= 0 && d <= EXPIRY_WARNING_DAYS;
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}
