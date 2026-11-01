"""Geographic helpers: haversine distance and implied travel speeds."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .constants import (
    EARTH_RADIUS_KM,
    MIN_ELAPSED_SECONDS,
    SECONDS_PER_HOUR,
)
from .schemas import Scan


@dataclass(frozen=True)
class TravelSegment:
    start: Scan
    end: Scan
    distance_km: float
    elapsed_s: float
    speed_kmh: float


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _has_position(scan: Scan) -> bool:
    return scan.lat is not None and scan.lon is not None


def travel_segments(scans: list[Scan]) -> list[TravelSegment]:
    """Consecutive (by time) geolocated scan pairs with implied speed."""
    located = sorted((s for s in scans if _has_position(s)), key=lambda s: s.scannedAt)
    segments: list[TravelSegment] = []
    for prev, cur in zip(located, located[1:]):
        assert prev.lat is not None and prev.lon is not None
        assert cur.lat is not None and cur.lon is not None
        distance = haversine_km(prev.lat, prev.lon, cur.lat, cur.lon)
        elapsed = max((cur.scannedAt - prev.scannedAt).total_seconds(), MIN_ELAPSED_SECONDS)
        speed = distance / (elapsed / SECONDS_PER_HOUR)
        segments.append(TravelSegment(prev, cur, distance, elapsed, speed))
    return segments
