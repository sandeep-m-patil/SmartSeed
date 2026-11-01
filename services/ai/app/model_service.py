"""Model lifecycle: train, evaluate and serve registered models."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

from .api_models import EvaluateRequest, TrainRequest
from .constants import (
    CLASSIFY_THRESHOLD,
    FEATURE_NAMES,
    FLAG_SIGNAL,
    HOLDOUT_FRACTION,
    QUANTILE_MEDIAN,
    QUANTILE_P95,
    MIN_HOLDOUT_ROWS,
    RANDOM_SEED,
    SYNTHETIC_WARNING,
)
from .ml import (
    TrainingError,
    anomaly_signals,
    rows_to_frame,
    supervised_probability,
    train_isolation_forest,
    train_xgboost,
    utc_now_iso,
    validate_labels,
)
from .registry import ModelRegistry


def _base_manifest(req: TrainRequest, frame: pd.DataFrame, algorithm: str) -> dict[str, Any]:
    return {
        "algorithm": algorithm,
        "trained_at": utc_now_iso(),
        "row_count": int(len(frame)),
        "features": list(FEATURE_NAMES),
        "data_description": req.dataDescription,
        "synthetic": req.synthetic,
        "synthetic_warning": SYNTHETIC_WARNING if req.synthetic else None,
    }


def classification_metrics(y_true: np.ndarray, proba: np.ndarray) -> dict[str, float]:
    """Genuinely computed on the supplied rows; requires both classes present."""
    pred = (proba >= CLASSIFY_THRESHOLD).astype(int)
    return {
        "roc_auc": float(roc_auc_score(y_true, proba)),
        "average_precision": float(average_precision_score(y_true, proba)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "threshold": CLASSIFY_THRESHOLD,
    }


def train_model(registry: ModelRegistry, name: str, req: TrainRequest) -> dict[str, Any]:
    """Train + register a new version. Labels => XGBoost, else IsolationForest."""
    frame = rows_to_frame(req.rows)
    if req.labels is None:
        bundle = train_isolation_forest(frame)
        manifest = _base_manifest(req, frame, "isolation_forest")
        manifest["calibration"] = bundle["calibration"]
        manifest["metrics"] = None
        manifest["metrics_note"] = "Unsupervised model: no accuracy metric is computed or claimed."
    else:
        manifest = _train_supervised(req, frame)
        bundle = manifest.pop("_bundle")
    version = registry.save(name, bundle, manifest)
    return registry.manifest(name, version)


def _train_supervised(req: TrainRequest, frame: pd.DataFrame) -> dict[str, Any]:
    assert req.labels is not None
    y = validate_labels(req.labels, len(frame))
    x_tr, x_te, y_tr, y_te = train_test_split(
        frame, y, test_size=HOLDOUT_FRACTION, random_state=RANDOM_SEED, stratify=y
    )
    use_holdout = len(y_te) >= MIN_HOLDOUT_ROWS and len(set(y_te)) == 2
    bundle = train_xgboost(x_tr if use_holdout else frame, y_tr if use_holdout else y)
    manifest = _base_manifest(req, frame, "xgboost")
    manifest["label_counts"] = {"0": int((y == 0).sum()), "1": int((y == 1).sum())}
    if use_holdout:
        metrics = classification_metrics(y_te, supervised_probability(bundle, x_te))
        manifest["metrics"] = {**metrics, "holdout_rows": int(len(y_te))}
        manifest["metrics_note"] = "Computed on a stratified holdout of the supplied data only."
    else:
        manifest["metrics"] = None
        manifest["metrics_note"] = "Holdout too small to compute metrics; none claimed."
    manifest["_bundle"] = bundle
    return manifest


def _unlabelled_summary(signals: np.ndarray) -> dict[str, Any]:
    return {
        "rows": int(len(signals)),
        "signal_mean": float(np.mean(signals)),
        "signal_p50": float(np.quantile(signals, QUANTILE_MEDIAN)),
        "signal_p95": float(np.quantile(signals, QUANTILE_P95)),
        "flagged_fraction": float(np.mean(signals >= FLAG_SIGNAL)),
    }


def evaluate_model(registry: ModelRegistry, name: str, req: EvaluateRequest) -> dict[str, Any] | None:
    """Evaluate a registered model on supplied rows. Returns None if the model is absent."""
    loaded = registry.load(name, req.version)
    if loaded is None:
        return None
    bundle, manifest = loaded
    frame = rows_to_frame(req.rows)
    if bundle["kind"] == "xgboost":
        scores = supervised_probability(bundle, frame)
    else:
        scores = anomaly_signals(bundle, frame)
    result: dict[str, Any] = {
        "model": name,
        "version": manifest["version"],
        "dataOrigin": {"description": req.dataDescription, "synthetic": req.synthetic},
        "syntheticWarning": SYNTHETIC_WARNING if req.synthetic else None,
        "summary": _unlabelled_summary(scores),
        "metrics": None,
    }
    if req.labels is not None:
        result["metrics"] = _labelled_metrics(req, scores)
    else:
        result["metricsNote"] = "No labels supplied: distribution summary only, no accuracy metrics."
    return result


def _labelled_metrics(req: EvaluateRequest, scores: np.ndarray) -> dict[str, float]:
    if len(req.labels or []) != len(scores):
        raise TrainingError("labels length must match rows length")
    y = np.asarray(req.labels)
    if len(set(y.tolist())) < 2 or not set(y.tolist()) <= {0, 1}:
        raise TrainingError("labels must be 0/1 and include both classes to compute metrics")
    return classification_metrics(y, scores)
