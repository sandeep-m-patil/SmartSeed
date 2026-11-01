"""Population Stability Index (PSI) drift utility."""
from __future__ import annotations

import numpy as np

from .constants import PSI_EPSILON, PSI_MODERATE, PSI_SIGNIFICANT


def psi(reference: np.ndarray, current: np.ndarray, bins: int) -> float:
    """PSI of `current` against `reference` using reference-quantile bins."""
    if len(reference) == 0 or len(current) == 0:
        raise ValueError("reference and current samples must be non-empty")
    interior = np.unique(np.quantile(reference, np.linspace(0, 1, bins + 1)))[1:-1]
    if len(interior) == 0:  # constant (or near-constant) reference
        interior = np.array([reference[0]])
    edges = np.concatenate([[-np.inf], interior, [np.inf]])
    ref_share = np.histogram(reference, bins=edges)[0] / len(reference)
    cur_share = np.histogram(current, bins=edges)[0] / len(current)
    ref_share = np.clip(ref_share, PSI_EPSILON, None)
    cur_share = np.clip(cur_share, PSI_EPSILON, None)
    return float(np.sum((cur_share - ref_share) * np.log(cur_share / ref_share)))


def drift_status(value: float) -> str:
    if value < PSI_MODERATE:
        return "stable"
    if value < PSI_SIGNIFICANT:
        return "moderate"
    return "significant"


def _column(rows: list[dict[str, float]], feature: str) -> np.ndarray:
    try:
        return np.array([row[feature] for row in rows], dtype=float)
    except KeyError as exc:
        raise ValueError(f"feature {feature!r} missing from some rows") from exc


def feature_drift(
    reference: list[dict[str, float]], current: list[dict[str, float]], features: list[str], bins: int
) -> dict[str, dict[str, float | str]]:
    report: dict[str, dict[str, float | str]] = {}
    for feature in features:
        value = psi(_column(reference, feature), _column(current, feature), bins)
        report[feature] = {"psi": round(value, 6), "status": drift_status(value)}
    return report
