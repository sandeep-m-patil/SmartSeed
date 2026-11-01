"""SYNTHETIC data generator. Output is generated, NOT real, and says nothing about
real-world detection performance. Every artifact derived from it must be labelled so.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

from .constants import SECONDS_PER_DAY
from .features import build_features
from .schemas import Context

SYNTHETIC_LABEL = "SYNTHETIC"
REFERENCE_NOW = datetime(2025, 6, 1, 12, 0, tzinfo=timezone.utc)
HYDERABAD = (17.385, 78.4867)
DELHI = (28.6139, 77.209)
INITIAL_QTY = 5000
KINDS = ("burst", "travel", "oversell", "dormant", "expired")
BENIGN_SCANS_MEAN = 15
BENIGN_SPAN_DAYS = 20
LOCATION_JITTER_DEG = 0.3
BURST_SCANS = 120
BURST_SECONDS = 600
DORMANT_SCANS = 80
DORMANT_GAP_DAYS = 60


def _scan(at: datetime, loc: tuple[float, float], device: str, rng: np.random.Generator) -> dict[str, Any]:
    jitter = rng.normal(0, LOCATION_JITTER_DEG, 2)
    return {
        "scannedAt": at.isoformat(),
        "lat": loc[0] + float(jitter[0]),
        "lon": loc[1] + float(jitter[1]),
        "deviceHash": device,
        "ipHash": f"ip-{device}",
        "result": "VALID",
    }


def _benign(rng: np.random.Generator) -> dict[str, Any]:
    count = int(rng.poisson(BENIGN_SCANS_MEAN))
    offsets = np.sort(rng.uniform(0, BENIGN_SPAN_DAYS * SECONDS_PER_DAY, count))
    scans = [
        _scan(REFERENCE_NOW - timedelta(seconds=float(o)), HYDERABAD, f"d{int(rng.integers(1_000_000))}", rng)
        for o in offsets
    ]
    sold = float(rng.uniform(0, 0.8) * INITIAL_QTY)
    batch = {
        "initialQuantity": INITIAL_QTY,
        "expiryDate": (REFERENCE_NOW + timedelta(days=float(rng.uniform(30, 700)))).isoformat(),
        "status": "ACTIVE",
        "qrStatus": "ACTIVE",
        "totalSold": sold,
        "totalTransferred": float(rng.uniform(sold, INITIAL_QTY)),
        "holdings": [],
    }
    return {"batch": batch, "scans": scans, "transfers": [], "events": []}


def _apply_anomaly(ctx: dict[str, Any], kind: str, rng: np.random.Generator) -> None:
    scans = ctx["scans"]
    if kind == "burst":
        start = REFERENCE_NOW - timedelta(hours=2)
        for i in range(BURST_SCANS):
            at = start + timedelta(seconds=i * BURST_SECONDS / BURST_SCANS)
            scans.append(_scan(at, HYDERABAD, f"b{int(rng.integers(5))}", rng))
    elif kind == "travel":
        t0 = REFERENCE_NOW - timedelta(minutes=30)
        scans.append(_scan(t0, HYDERABAD, "t1", rng))
        scans.append(_scan(t0 + timedelta(minutes=2), DELHI, "t2", rng))
    elif kind == "oversell":
        ctx["batch"]["totalSold"] = INITIAL_QTY * float(rng.uniform(1.1, 1.6))
    elif kind == "dormant":
        ctx["scans"] = []
        base = REFERENCE_NOW - timedelta(days=DORMANT_GAP_DAYS)
        ctx["scans"].append(_scan(base, HYDERABAD, "old", rng))
        for i in range(DORMANT_SCANS):
            ctx["scans"].append(_scan(REFERENCE_NOW - timedelta(minutes=5 * i), HYDERABAD, f"n{i}", rng))
    elif kind == "expired":
        ctx["batch"]["expiryDate"] = (REFERENCE_NOW - timedelta(days=float(rng.uniform(5, 200)))).isoformat()


def generate_rows(n_benign: int, n_anomalous: int, seed: int) -> list[dict[str, Any]]:
    """Feature rows with `label` (0 benign / 1 anomalous) and `kind`. SYNTHETIC."""
    rng = np.random.default_rng(seed)
    rows: list[dict[str, Any]] = []
    for index in range(n_benign + n_anomalous):
        is_anomalous = index >= n_benign
        raw = _benign(rng)
        kind = "benign"
        if is_anomalous:
            kind = KINDS[(index - n_benign) % len(KINDS)]
            _apply_anomaly(raw, kind, rng)
        features = build_features(Context.model_validate(raw), REFERENCE_NOW)
        rows.append({"label": int(is_anomalous), "kind": kind, "origin": SYNTHETIC_LABEL, **features})
    return rows
