"""Deterministic scan-behaviour and geo rule detectors."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta

from .constants import (
    BURST_FULL_COUNT,
    BURST_MIN_COUNT,
    BURST_WINDOW_SECONDS,
    DORMANT_BASE_SIGNAL,
    DORMANT_DAYS,
    DORMANT_FULL_SCANS,
    DORMANT_MIN_RECENT_SCANS,
    FAMILY_GEO,
    FAMILY_SCAN,
    IMPOSSIBLE_BASE_SIGNAL,
    IMPOSSIBLE_SPEED_SPAN_KMH,
    MAX_PLAUSIBLE_SPEED_KMH,
    MIN_TRAVEL_KM,
    RECENT_WINDOW_HOURS,
    REPEAT_DEVICE_FULL_SCANS,
    REPEAT_DEVICE_MIN_SCANS,
    SECONDS_PER_DAY,
)
from .features import max_window_count, scan_times
from .geo import travel_segments
from .indicators import Detection, clamp01, make_detection
from .schemas import Context, Evidence


def detect_burst(ctx: Context, now: datetime) -> list[Detection]:
    count = max_window_count(scan_times(ctx.scans), BURST_WINDOW_SECONDS)
    if count < BURST_MIN_COUNT:
        return []
    minutes = int(BURST_WINDOW_SECONDS // 60)
    return [
        make_detection(
            "SCAN_BURST",
            FAMILY_SCAN,
            count / BURST_FULL_COUNT,
            f"{count} scans within a {minutes}-minute window.",
            [Evidence(kind="scan_window", ref="scans", detail=f"max_scans_in_window={count}")],
        )
    ]


def detect_impossible_travel(ctx: Context, now: datetime) -> list[Detection]:
    flagged = [
        seg
        for seg in travel_segments(ctx.scans)
        if seg.distance_km >= MIN_TRAVEL_KM and seg.speed_kmh > MAX_PLAUSIBLE_SPEED_KMH
    ]
    if not flagged:
        return []
    worst = max(flagged, key=lambda seg: seg.speed_kmh)
    excess = (worst.speed_kmh - MAX_PLAUSIBLE_SPEED_KMH) / IMPOSSIBLE_SPEED_SPAN_KMH
    signal = IMPOSSIBLE_BASE_SIGNAL + (1 - IMPOSSIBLE_BASE_SIGNAL) * clamp01(excess)
    detail = (
        f"{worst.distance_km:.0f} km in {worst.elapsed_s:.0f} s "
        f"(~{worst.speed_kmh:.0f} km/h); {len(flagged)} implausible hop(s)."
    )
    evidence = Evidence(
        kind="scan_pair",
        ref=f"{worst.start.scannedAt.isoformat()}|{worst.end.scannedAt.isoformat()}",
        detail=detail,
    )
    return [make_detection("IMPOSSIBLE_TRAVEL", FAMILY_GEO, signal, detail, [evidence])]


def detect_dormant_spike(ctx: Context, now: datetime) -> list[Detection]:
    window_start = now - timedelta(hours=RECENT_WINDOW_HOURS)
    recent = [s for s in ctx.scans if window_start <= s.scannedAt <= now]
    if len(recent) < DORMANT_MIN_RECENT_SCANS:
        return []
    earlier = [s.scannedAt for s in ctx.scans if s.scannedAt < window_start]
    earlier += [e.occurredAt for e in ctx.events if e.occurredAt < window_start]
    if not earlier:
        return []
    gap_days = (window_start - max(earlier)).total_seconds() / SECONDS_PER_DAY
    if gap_days < DORMANT_DAYS:
        return []
    signal = DORMANT_BASE_SIGNAL + (1 - DORMANT_BASE_SIGNAL) * clamp01(
        len(recent) / DORMANT_FULL_SCANS
    )
    detail = f"{len(recent)} scans in the last {RECENT_WINDOW_HOURS:.0f}h after {gap_days:.0f} days of inactivity."
    return [
        make_detection(
            "DORMANT_QR_SPIKE",
            FAMILY_SCAN,
            signal,
            detail,
            [Evidence(kind="activity_gap", ref="scans", detail=detail)],
        )
    ]


def detect_repeat_device(ctx: Context, now: datetime) -> list[Detection]:
    counts = Counter(s.deviceHash for s in ctx.scans if s.deviceHash)
    if not counts:
        return []
    device, top = counts.most_common(1)[0]
    if top < REPEAT_DEVICE_MIN_SCANS:
        return []
    detail = f"One device produced {top} of {len(ctx.scans)} scans."
    return [
        make_detection(
            "REPEAT_DEVICE_SCANS",
            FAMILY_SCAN,
            top / REPEAT_DEVICE_FULL_SCANS,
            detail,
            [Evidence(kind="device", ref=device, detail=detail)],
        )
    ]


SCAN_DETECTORS = (detect_burst, detect_impossible_travel, detect_dormant_spike, detect_repeat_device)
