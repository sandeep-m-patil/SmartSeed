"""Risk engine: normalised signals -> correlation families -> weighted 0-100 score.

Method (documented, deterministic):
  1. Every indicator carries a normalised signal in [0, 1] and a correlation family.
  2. Family score = MAX signal inside the family (correlated signals are not summed,
     so e.g. a burst and a repeat-device hit on the same scans count once).
  3. final = 100 * sum(w_f * s_f) / sum(w_f), rounded half-up.
  4. Override floors then raise (never lower) the score:
       chain verification failed / revoked QR scanned -> >= 75
       expired batch moved                              -> >= 50
       any family score >= 0.8 (strong specific signal) -> >= 50
     The strong-signal floor exists because a weighted average over seven families
     would otherwise dilute a single decisive signal (e.g. 100 scans in 10 minutes).
Weights/thresholds can be overridden per request within validated bounds; floors cannot.
"""
from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field
from typing import Any

from .constants import (
    CONFIDENCE_ACTIVE_FAMILY_SIGNAL,
    CONFIDENCE_CORROBORATING_FAMILIES,
    CONFIDENCE_DATA_WEIGHT,
    CONFIDENCE_FULL_SCANS,
    CONFIDENCE_MIN,
    CONFIG_VERSION,
    CRITICAL_FLOOR,
    CUSTOM_CONFIG_SUFFIX,
    DEFAULT_THRESHOLD_HIGH_MAX,
    DEFAULT_THRESHOLD_LOW_MAX,
    DEFAULT_THRESHOLD_MEDIUM_MAX,
    EXPIRED_FLOOR,
    FAMILY_ACTOR,
    FAMILY_CHAIN,
    FAMILY_EXPIRY,
    FAMILY_GEO,
    FAMILY_INVENTORY,
    FAMILY_ML,
    FAMILY_SCAN,
    LEVEL_CRITICAL,
    LEVEL_HIGH,
    LEVEL_LOW,
    LEVEL_MEDIUM,
    MAX_SCORE,
    STRONG_SIGNAL_FLOOR,
    STRONG_SIGNAL_THRESHOLD,
)
from .detectors_chain import CODE_CHAIN_FAILED, CODE_EXPIRED_MOVED, CODE_REVOKED_SCANNED
from .indicators import clamp01
from .schemas import ConfigOverride, Context, Indicator, Level

FAMILIES = (FAMILY_SCAN, FAMILY_GEO, FAMILY_CHAIN, FAMILY_INVENTORY, FAMILY_EXPIRY, FAMILY_ACTOR, FAMILY_ML)

DEFAULT_CONFIG: dict[str, Any] = {
    "configVersion": CONFIG_VERSION,
    "weights": {
        FAMILY_SCAN: 0.20,
        FAMILY_GEO: 0.15,
        FAMILY_CHAIN: 0.20,
        FAMILY_INVENTORY: 0.15,
        FAMILY_EXPIRY: 0.10,
        FAMILY_ACTOR: 0.10,
        FAMILY_ML: 0.10,
    },
    "thresholds": {
        "lowMax": DEFAULT_THRESHOLD_LOW_MAX,
        "mediumMax": DEFAULT_THRESHOLD_MEDIUM_MAX,
        "highMax": DEFAULT_THRESHOLD_HIGH_MAX,
    },
    "floors": {
        CODE_CHAIN_FAILED: CRITICAL_FLOOR,
        CODE_REVOKED_SCANNED: CRITICAL_FLOOR,
        CODE_EXPIRED_MOVED: EXPIRED_FLOOR,
        "strongSignal": {"threshold": STRONG_SIGNAL_THRESHOLD, "floor": STRONG_SIGNAL_FLOOR},
    },
}

RECOMMENDED_ACTIONS: dict[str, str] = {
    LEVEL_LOW: "Normal verification. No additional action required.",
    LEVEL_MEDIUM: "Additional verification recommended.",
    LEVEL_HIGH: "Manual investigation required.",
    LEVEL_CRITICAL: (
        "Urgent alert. PROPOSE a temporary hold on this batch via the authorised "
        "approval workflow; the hold must be approved by an authorised user. "
        "This score alone is not a determination of authenticity."
    ),
}

THRESHOLD_KEYS = ("lowMax", "mediumMax", "highMax")
MIN_THRESHOLD = 1


class ConfigError(ValueError):
    """Raised when a request config override is invalid."""


@dataclass(frozen=True)
class RiskResult:
    score: int
    level: Level
    family_scores: dict[str, float]
    floors_applied: list[str] = field(default_factory=list)
    dominant_family: str | None = None


def _merge_weights(config: dict[str, Any], weights: dict[str, float]) -> None:
    unknown = set(weights) - set(FAMILIES)
    if unknown:
        raise ConfigError(f"unknown weight families: {sorted(unknown)}")
    if any(w < 0 or not math.isfinite(w) for w in weights.values()):
        raise ConfigError("weights must be finite and non-negative")
    config["weights"].update(weights)
    if sum(config["weights"].values()) <= 0:
        raise ConfigError("at least one weight must be positive")


def _merge_thresholds(config: dict[str, Any], thresholds: dict[str, int]) -> None:
    unknown = set(thresholds) - set(THRESHOLD_KEYS)
    if unknown:
        raise ConfigError(f"unknown thresholds: {sorted(unknown)}")
    config["thresholds"].update(thresholds)
    low, med, high = (config["thresholds"][k] for k in THRESHOLD_KEYS)
    if not (MIN_THRESHOLD <= low < med < high < MAX_SCORE):
        raise ConfigError("thresholds must satisfy 1 <= lowMax < mediumMax < highMax < 100")


def resolve_config(override: ConfigOverride | None) -> dict[str, Any]:
    config = copy.deepcopy(DEFAULT_CONFIG)
    if override is None or (override.weights is None and override.thresholds is None):
        return config
    if override.weights:
        _merge_weights(config, override.weights)
    if override.thresholds:
        _merge_thresholds(config, override.thresholds)
    config["configVersion"] = f"{CONFIG_VERSION}{CUSTOM_CONFIG_SUFFIX}"
    return config


def classify_level(score: int, thresholds: dict[str, int] | None = None) -> Level:
    cuts = thresholds or DEFAULT_CONFIG["thresholds"]
    if score <= cuts["lowMax"]:
        return LEVEL_LOW
    if score <= cuts["mediumMax"]:
        return LEVEL_MEDIUM
    if score <= cuts["highMax"]:
        return LEVEL_HIGH
    return LEVEL_CRITICAL


def family_scores(indicators: list[Indicator]) -> dict[str, float]:
    """MAX within each family; families with no indicators score 0."""
    scores = {family: 0.0 for family in FAMILIES}
    for ind in indicators:
        if ind.family not in scores:
            raise ValueError(f"unknown family: {ind.family}")
        scores[ind.family] = max(scores[ind.family], clamp01(ind.normalizedSignal))
    return scores


def _weighted_score(scores: dict[str, float], weights: dict[str, float]) -> float:
    total_weight = sum(weights.values())
    return MAX_SCORE * sum(weights[f] * scores[f] for f in FAMILIES) / total_weight


def _floors(indicators: list[Indicator], scores: dict[str, float], config: dict[str, Any]) -> dict[str, int]:
    floors: dict[str, int] = {}
    for code in (CODE_CHAIN_FAILED, CODE_REVOKED_SCANNED, CODE_EXPIRED_MOVED):
        if any(i.code == code for i in indicators):
            floors[code] = config["floors"][code]
    strong = config["floors"]["strongSignal"]
    if max(scores.values()) >= strong["threshold"]:
        floors["STRONG_SIGNAL"] = strong["floor"]
    return floors


def _round_half_up(value: float) -> int:
    return int(math.floor(value + 0.5))


def compute_risk(indicators: list[Indicator], config: dict[str, Any]) -> RiskResult:
    scores = family_scores(indicators)
    weights = config["weights"]
    score = _round_half_up(_weighted_score(scores, weights))
    floors = _floors(indicators, scores, config)
    applied = [name for name, floor in floors.items() if floor > score]
    score = min(MAX_SCORE, max([score, *floors.values()]))
    contributions = {f: weights[f] * scores[f] for f in FAMILIES if scores[f] > 0}
    dominant = max(contributions, key=lambda f: contributions[f]) if contributions else None
    return RiskResult(score, classify_level(score, config["thresholds"]), scores, applied, dominant)


def compute_confidence(ctx: Context, scores: dict[str, float]) -> float:
    """Heuristic in [0.2, 1]: data sufficiency blended with corroboration across families.

    Not a calibrated probability.
    """
    coverage = [
        min(len(ctx.scans) / CONFIDENCE_FULL_SCANS, 1.0),
        1.0 if ctx.batch.initialQuantity > 0 else 0.0,
        1.0 if ctx.chainVerified is not None else 0.0,
        1.0 if (ctx.transfers or ctx.events) else 0.0,
    ]
    data = sum(coverage) / len(coverage)
    active = sum(1 for s in scores.values() if s >= CONFIDENCE_ACTIVE_FAMILY_SIGNAL)
    corroboration = min(active / CONFIDENCE_CORROBORATING_FAMILIES, 1.0)
    blended = CONFIDENCE_DATA_WEIGHT * data + (1 - CONFIDENCE_DATA_WEIGHT) * corroboration
    return round(max(CONFIDENCE_MIN, min(1.0, blended)), 2)
