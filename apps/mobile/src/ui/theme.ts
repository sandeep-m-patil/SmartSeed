import type { DisplayIndicator } from '../domain/types';
import type { StatusLevel } from '../domain/statusRows';

export const MIN_TOUCH_TARGET = 56; // dp
export const FONT = { body: 18, label: 16, title: 26, hero: 32, button: 20 } as const;
export const SPACE = { xs: 6, sm: 12, md: 16, lg: 24 } as const;

export const COLORS = {
  background: '#FFFFFF',
  surface: '#F3F4F6',
  text: '#111827',
  textMuted: '#374151',
  primary: '#14532D',
  onPrimary: '#FFFFFF',
  border: '#111827',
  warnBannerBg: '#FEF3C7',
  warnBannerText: '#78350F',
} as const;

/** High-contrast pairs (all >= 7:1 text on background). */
export const INDICATOR_COLORS: Record<DisplayIndicator, { bg: string; fg: string; icon: string }> = {
  GREEN: { bg: '#14532D', fg: '#FFFFFF', icon: '✔' },
  YELLOW: { bg: '#FDE047', fg: '#111827', icon: '!' },
  RED: { bg: '#991B1B', fg: '#FFFFFF', icon: '✖' },
  LAST_CHECKED: { bg: '#E5E7EB', fg: '#111827', icon: '⟳' },
};

export const LEVEL_COLORS: Record<StatusLevel, { bg: string; fg: string; icon: string }> = {
  ok: INDICATOR_COLORS.GREEN,
  warn: INDICATOR_COLORS.YELLOW,
  bad: INDICATOR_COLORS.RED,
  neutral: INDICATOR_COLORS.LAST_CHECKED,
};
