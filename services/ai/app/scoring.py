"""Scoring orchestration: detectors + statistics + models -> ScoreResponse."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .constants import (
    DISCLAIMER,
    FAMILY_ML,
    RULES_VERSION,
)
from .detectors_chain import CHAIN_DETECTORS
from .detectors_scan import SCAN_DETECTORS
from .features import build_features
from .indicators import Detection, make_detection
from .ml import signal_for_row
from .registry import ModelRegistry
from .risk_engine import (
    FAMILIES,
    RECOMMENDED_ACTIONS,
    compute_confidence,
    compute_risk,
    resolve_config,
)
from .schemas import Context, ScoreRequest, ScoreResponse
from .stats import STAT_DETECTORS

Loaded = tuple[dict[str, Any], dict[str, Any]]
CATEGORY_BY_FAMILY = {
    "scan_behaviour": "SCAN_ANOMALY",
    "geo": "GEO_ANOMALY",
    "chain_integrity": "INTEGRITY_ISSUE",
    "inventory": "INVENTORY_DISCREPANCY",
    "expiry": "EXPIRED_PRODUCT_MOVEMENT",
    "actor_history": "ACTOR_RISK",
    "ml": "STATISTICAL_OUTLIER",
}
CATEGORY_NORMAL = "NORMAL"
NOTE_NO_MODEL = (
    "No trained anomaly model is loaded: scoring uses deterministic rules and robust "
    "statistics only (mode 'rules+unsupervised')."
)


class ModelProvider:
    """Loads the active models from the registry, caching by (name, version)."""

    def __init__(self, registry: ModelRegistry, unsupervised: str, supervised: str) -> None:
        self.registry = registry
        self.names = {"unsupervised": unsupervised, "supervised": supervised}
        self._cache: dict[str, tuple[str, Loaded]] = {}

    def _get(self, name: str) -> Loaded | None:
        latest = self.registry.latest_version(name)
        if latest is None:
            self._cache.pop(name, None)
            return None
        cached = self._cache.get(name)
        if cached is None or cached[0] != latest:
            loaded = self.registry.load(name, latest)
            if loaded is None:
                return None
            self._cache[name] = (latest, loaded)
        return self._cache[name][1]

    def unsupervised(self) -> Loaded | None:
        return self._get(self.names["unsupervised"])

    def supervised(self) -> Loaded | None:
        return self._get(self.names["supervised"])


@dataclass
class ModelOutcome:
    detections: list[Detection] = field(default_factory=list)
    version_parts: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    is_supervised: bool = False


def _model_detection(code: str, signal: float, manifest: dict[str, Any]) -> Detection:
    label = f"{manifest['name']}/{manifest['version']}"
    desc = f"Model {label} relative anomaly signal {signal:.2f}."
    return make_detection(code, FAMILY_ML, signal, desc)


def run_models(features: dict[str, float], provider: ModelProvider) -> ModelOutcome:
    outcome = ModelOutcome()
    for kind, code in (("unsupervised", "ML_ANOMALY"), ("supervised", "ML_SUPERVISED")):
        loaded = getattr(provider, kind)()
        if loaded is None:
            continue
        bundle, manifest = loaded
        signal = signal_for_row(bundle, features)
        outcome.detections.append(_model_detection(code, signal, manifest))
        outcome.version_parts.append(f"{manifest['name']}/{manifest['version']}")
        outcome.is_supervised = outcome.is_supervised or kind == "supervised"
        if manifest.get("synthetic"):
            outcome.notes.append(f"Model {manifest['name']}/{manifest['version']} was trained on SYNTHETIC data.")
    if not outcome.detections:
        outcome.notes.append(NOTE_NO_MODEL)
    return outcome


def run_rules(ctx: Context, req: ScoreRequest) -> list[Detection]:
    detections: list[Detection] = []
    for detector in (*SCAN_DETECTORS, *CHAIN_DETECTORS, *STAT_DETECTORS):
        detections.extend(detector(ctx, req.now))
    return detections


def score_request(req: ScoreRequest, provider: ModelProvider) -> ScoreResponse:
    config = resolve_config(req.config)
    detections = run_rules(req.context, req)
    outcome = run_models(build_features(req.context, req.now), provider)
    detections += outcome.detections
    indicators = [d.indicator for d in detections]
    result = compute_risk(indicators, config)
    category = CATEGORY_BY_FAMILY.get(result.dominant_family or "", CATEGORY_NORMAL)
    notes = list(outcome.notes)
    if result.floors_applied:
        notes.append(f"Override floor(s) applied: {', '.join(result.floors_applied)}.")
    return ScoreResponse(
        riskScore=result.score,
        level=result.level,
        category=category,
        severity=result.level,
        indicators=indicators,
        confidence=compute_confidence(req.context, result.family_scores),
        evidence=[e for d in detections for e in d.evidence],
        recommendedAction=RECOMMENDED_ACTIONS[result.level],
        modelVersion="+".join([RULES_VERSION, *outcome.version_parts]),
        mode="hybrid-supervised" if outcome.is_supervised else "rules+unsupervised",
        componentScores={f: round(result.family_scores[f], 4) for f in FAMILIES},
        configVersion=config["configVersion"],
        notes=notes,
        disclaimer=DISCLAIMER,
    )
