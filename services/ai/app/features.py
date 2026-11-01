"""Feature engineering: ScoreRequest context -> numeric feature vector."""
from __future__ import annotations

from datetime import datetime

import numpy as np

from .constants import (
    FEATURE_NAMES,
    BURST_WINDOW_SECONDS,
    LOCATION_ROUND_DIGITS,
    NO_EXPIRY_DAYS,
    MAX_SPEED_FEATURE_KMH,
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
)
from .geo import travel_segments
from .schemas import Context, Scan


def scan_times(scans: list[Scan]) -> list[float]:
    """Sorted epoch seconds of scans."""
    return sorted(s.scannedAt.timestamp() for s in scans)


def inter_arrival_seconds(times: list[float]) -> list[float]:
    return [b - a for a, b in zip(times, times[1:])]


def max_window_count(times: list[float], window_s: float) -> int:
    """Largest number of events inside any sliding window (two-pointer)."""
    best, left = 0, 0
    for right, t in enumerate(times):
        while t - times[left] > window_s:
            left += 1
        best = max(best, right - left + 1)
    return best


def _distinct_locations(scans: list[Scan]) -> int:
    cells = {
        (round(s.lat, LOCATION_ROUND_DIGITS), round(s.lon, LOCATION_ROUND_DIGITS))
        for s in scans
        if s.lat is not None and s.lon is not None
    }
    return len(cells)


def _scan_rate(times: list[float]) -> float:
    if len(times) < 2:
        return float(len(times))
    span_hours = max((times[-1] - times[0]) / SECONDS_PER_HOUR, 1.0)
    return len(times) / span_hours


def _quantity_ratio(ctx: Context) -> float:
    initial = ctx.batch.initialQuantity
    if initial <= 0:
        return 0.0
    return max(ctx.batch.totalSold, ctx.batch.totalTransferred) / initial


def _days_to_expiry(ctx: Context, now: datetime) -> float:
    if ctx.batch.expiryDate is None:
        return NO_EXPIRY_DAYS
    return (ctx.batch.expiryDate - now).total_seconds() / SECONDS_PER_DAY


def build_features(ctx: Context, now: datetime) -> dict[str, float]:
    times = scan_times(ctx.scans)
    gaps = inter_arrival_seconds(times)
    speeds = [seg.speed_kmh for seg in travel_segments(ctx.scans)]
    devices = {s.deviceHash for s in ctx.scans if s.deviceHash}
    span_days = max((now - min((t.createdAt for t in ctx.transfers), default=now)).days, 1)
    features = {
        "scan_count": float(len(times)),
        "scan_rate_per_hour": _scan_rate(times),
        "inter_scan_mean_s": float(np.mean(gaps)) if gaps else 0.0,
        "inter_scan_std_s": float(np.std(gaps)) if gaps else 0.0,
        "distinct_devices": float(len(devices)),
        "distinct_locations": float(_distinct_locations(ctx.scans)),
        "max_speed_kmh": min(max(speeds, default=0.0), MAX_SPEED_FEATURE_KMH),
        "transfer_frequency": len(ctx.transfers) / span_days,
        "quantity_ratio": _quantity_ratio(ctx),
        "days_to_expiry": _days_to_expiry(ctx, now),
        "max_scans_10min": float(max_window_count(times, BURST_WINDOW_SECONDS)),
    }
    return {name: features[name] for name in FEATURE_NAMES}
