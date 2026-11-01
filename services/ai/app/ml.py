"""Model training/inference: IsolationForest (unsupervised) and optional XGBoost."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from .constants import (
    CALIBRATION_HIGH_QUANTILE,
    CALIBRATION_LOW_QUANTILE,
    CALIBRATION_MIN_SPAN,
    FEATURE_NAMES,
    IFOREST_ESTIMATORS,
    MIN_LABELLED_ROWS,
    MIN_ROWS_PER_CLASS,
    MIN_TRAIN_ROWS,
    RANDOM_SEED,
    XGB_ESTIMATORS,
    XGB_LEARNING_RATE,
    XGB_MAX_DEPTH,
)
from .indicators import clamp01


class TrainingError(ValueError):
    """Training input is insufficient or invalid (maps to HTTP 400)."""


def rows_to_frame(rows: list[dict[str, float]]) -> pd.DataFrame:
    if not rows:
        raise TrainingError("no feature rows supplied")
    frame = pd.DataFrame(rows)
    missing = [f for f in FEATURE_NAMES if f not in frame.columns]
    if missing:
        raise TrainingError(f"rows are missing features: {missing}")
    frame = frame[list(FEATURE_NAMES)].apply(pd.to_numeric, errors="coerce")
    if not np.isfinite(frame.to_numpy(dtype=float)).all():
        raise TrainingError("feature rows must contain only finite numbers")
    return frame.astype(float)


def _calibration(raw_scores: np.ndarray) -> dict[str, float]:
    low = float(np.quantile(raw_scores, CALIBRATION_LOW_QUANTILE))
    high = float(np.quantile(raw_scores, CALIBRATION_HIGH_QUANTILE))
    return {"low": low, "high": max(high, low + CALIBRATION_MIN_SPAN)}


def train_isolation_forest(frame: pd.DataFrame) -> dict[str, Any]:
    if len(frame) < MIN_TRAIN_ROWS:
        raise TrainingError(f"at least {MIN_TRAIN_ROWS} rows are required (got {len(frame)})")
    model = IsolationForest(
        n_estimators=IFOREST_ESTIMATORS, contamination="auto", random_state=RANDOM_SEED
    )
    model.fit(frame.to_numpy())
    raw = -model.score_samples(frame.to_numpy())
    return {
        "kind": "isolation_forest",
        "estimator": model,
        "features": list(FEATURE_NAMES),
        "calibration": _calibration(raw),
    }


def anomaly_signals(bundle: dict[str, Any], frame: pd.DataFrame) -> np.ndarray:
    """Normalised [0,1] anomaly signal per row.

    0 = at/below the median training score, 1 = at/above the 99th percentile of the
    training scores. This is a relative ranking, not a probability.
    """
    raw = -bundle["estimator"].score_samples(frame[bundle["features"]].to_numpy())
    cal = bundle["calibration"]
    return np.clip((raw - cal["low"]) / (cal["high"] - cal["low"]), 0.0, 1.0)


def _import_xgboost() -> Any:
    try:
        import xgboost  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise TrainingError(
            "xgboost is not installed; supervised training is unavailable "
            "(pip install -r requirements-optional.txt)"
        ) from exc
    return xgboost


def validate_labels(labels: list[int], n_rows: int) -> np.ndarray:
    if len(labels) != n_rows:
        raise TrainingError("labels length must match rows length")
    y = np.asarray(labels)
    if not set(np.unique(y)) <= {0, 1}:
        raise TrainingError("labels must be 0 or 1")
    if len(y) < MIN_LABELLED_ROWS:
        raise TrainingError(f"at least {MIN_LABELLED_ROWS} labelled rows required (got {len(y)})")
    if min(int((y == 0).sum()), int((y == 1).sum())) < MIN_ROWS_PER_CLASS:
        raise TrainingError(f"each class needs at least {MIN_ROWS_PER_CLASS} labelled rows")
    return y


def train_xgboost(frame: pd.DataFrame, y: np.ndarray) -> dict[str, Any]:
    xgb = _import_xgboost()
    model = xgb.XGBClassifier(
        n_estimators=XGB_ESTIMATORS, max_depth=XGB_MAX_DEPTH,
        learning_rate=XGB_LEARNING_RATE, random_state=RANDOM_SEED,
    )
    model.fit(frame.to_numpy(), y)
    return {"kind": "xgboost", "estimator": model, "features": list(FEATURE_NAMES)}


def supervised_probability(bundle: dict[str, Any], frame: pd.DataFrame) -> np.ndarray:
    proba = bundle["estimator"].predict_proba(frame[bundle["features"]].to_numpy())
    return np.clip(proba[:, 1], 0.0, 1.0)


def signal_for_row(bundle: dict[str, Any], features: dict[str, float]) -> float:
    frame = pd.DataFrame([features])
    if bundle["kind"] == "xgboost":
        return clamp01(float(supervised_probability(bundle, frame)[0]))
    return clamp01(float(anomaly_signals(bundle, frame)[0]))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
