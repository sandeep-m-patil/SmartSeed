"""Robust statistics (modified z-score / MAD) over scan timing and volume."""
from __future__ import annotations

from datetime import datetime

import numpy as np

from .constants import (
    FAMILY_SCAN,
    INTERVAL_MIN_FRACTION,
    INTERVAL_OUTLIER_FULL_FRACTION,
    MAD_NORMAL_CONSISTENCY,
    MIN_INTERVALS_FOR_STATS,
    MIN_SHORT_INTERVAL_OUTLIERS,
    MODIFIED_Z_THRESHOLD,
    SECONDS_PER_DAY,
    VOLUME_BASE_SIGNAL,
    VOLUME_HISTORY_DAYS,
    VOLUME_MIN_CURRENT,
    VOLUME_MIN_HISTORY_DAYS,
    VOLUME_MIN_SCALE,
    VOLUME_Z_FULL_EXTRA,
)
from .features import inter_arrival_seconds, scan_times
from .indicators import Detection, clamp01, make_detection
from .schemas import Context, Evidence


def mad(values: np.ndarray) -> float:
    """Median absolute deviation."""
    return float(np.median(np.abs(values - np.median(values))))


def modified_z_scores(values: np.ndarray, min_scale: float = 0.0) -> np.ndarray:
    """0.6745 * (x - median) / MAD. A zero MAD falls back to `min_scale` (or zeros)."""
    scale = max(mad(values), min_scale)
    if scale <= 0:
        return np.zeros_like(values, dtype=float)
    return MAD_NORMAL_CONSISTENCY * (values - np.median(values)) / scale


def detect_interval_outliers(ctx: Context, now: datetime) -> list[Detection]:
    """Share of inter-scan gaps that are abnormally SHORT versus the batch's own median."""
    raw = np.array(inter_arrival_seconds(scan_times(ctx.scans)), dtype=float)
    if len(raw) < MIN_INTERVALS_FOR_STATS:
        return []
    gaps = np.log1p(raw)  # log scale: inter-arrival times are heavily right-skewed
    short = int(np.sum(modified_z_scores(gaps) < -MODIFIED_Z_THRESHOLD))
    fraction = short / len(gaps)
    if short < MIN_SHORT_INTERVAL_OUTLIERS or fraction < INTERVAL_MIN_FRACTION:
        return []
    detail = f"{short} of {len(gaps)} inter-scan gaps are abnormally short (robust z of log-gap < -{MODIFIED_Z_THRESHOLD})."
    return [
        make_detection(
            "SCAN_INTERVAL_OUTLIER",
            FAMILY_SCAN,
            fraction / INTERVAL_OUTLIER_FULL_FRACTION,
            detail,
            [Evidence(kind="statistic", ref="inter_arrival", detail=detail)],
        )
    ]


def daily_counts(ctx: Context, now: datetime) -> np.ndarray:
    """Scan counts per day; index 0 is the 24h ending at `now`."""
    counts = np.zeros(VOLUME_HISTORY_DAYS, dtype=float)
    for scan in ctx.scans:
        age_days = int((now - scan.scannedAt).total_seconds() // SECONDS_PER_DAY)
        if 0 <= age_days < VOLUME_HISTORY_DAYS:
            counts[age_days] += 1
    return counts


def detect_volume_outlier(ctx: Context, now: datetime) -> list[Detection]:
    """Robust z-score of today's per-batch scan volume versus the preceding days."""
    if not ctx.scans:
        return []
    oldest_days = (now - min(s.scannedAt for s in ctx.scans)).total_seconds() / SECONDS_PER_DAY
    counts = daily_counts(ctx, now)
    current = counts[0]
    if oldest_days < VOLUME_MIN_HISTORY_DAYS or current < VOLUME_MIN_CURRENT:
        return []
    history = counts[1:]
    scale = max(mad(history), VOLUME_MIN_SCALE)
    z = MAD_NORMAL_CONSISTENCY * (current - float(np.median(history))) / scale
    if z < MODIFIED_Z_THRESHOLD:
        return []
    extra = clamp01((z - MODIFIED_Z_THRESHOLD) / VOLUME_Z_FULL_EXTRA)
    signal = VOLUME_BASE_SIGNAL + (1 - VOLUME_BASE_SIGNAL) * extra
    detail = f"Today's volume {current:.0f} scans is a robust z of {z:.1f} versus prior days."
    return [
        make_detection(
            "SCAN_VOLUME_OUTLIER",
            FAMILY_SCAN,
            signal,
            detail,
            [Evidence(kind="statistic", ref="daily_volume", detail=detail)],
        )
    ]


STAT_DETECTORS = (detect_interval_outliers, detect_volume_outlier)
