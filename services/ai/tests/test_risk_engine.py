import pytest

from app.constants import FAMILY_ML, FAMILY_SCAN
from app.indicators import make_detection, severity_for
from app.risk_engine import (
    DEFAULT_CONFIG,
    FAMILIES,
    ConfigError,
    classify_level,
    compute_confidence,
    compute_risk,
    family_scores,
    resolve_config,
)
from app.schemas import ConfigOverride

from .conftest import benign_payload, ctx_of


def ind(code, family, signal):
    return make_detection(code, family, signal, "d").indicator


@pytest.mark.parametrize(
    "score,level",
    [(0, "LOW"), (24, "LOW"), (25, "MEDIUM"), (49, "MEDIUM"), (50, "HIGH"), (74, "HIGH"), (75, "CRITICAL"), (100, "CRITICAL")],
)
def test_level_boundaries(score, level):
    assert classify_level(score) == level


def test_no_indicators_scores_zero_low():
    result = compute_risk([], resolve_config(None))
    assert (result.score, result.level, result.dominant_family) == (0, "LOW", None)


def test_family_uses_max_not_sum_to_avoid_double_counting():
    one = compute_risk([ind("A", FAMILY_SCAN, 0.6)], resolve_config(None))
    many = compute_risk(
        [ind("A", FAMILY_SCAN, 0.6), ind("B", FAMILY_SCAN, 0.6), ind("C", FAMILY_SCAN, 0.4)], resolve_config(None)
    )
    assert many.score == one.score
    assert many.family_scores[FAMILY_SCAN] == 0.6


def test_distinct_families_do_add():
    one = compute_risk([ind("A", FAMILY_SCAN, 0.6)], resolve_config(None))
    two = compute_risk([ind("A", FAMILY_SCAN, 0.6), ind("B", FAMILY_ML, 0.6)], resolve_config(None))
    assert two.score > one.score


def test_weighted_formula_matches_documented_default_weights():
    result = compute_risk([ind("A", FAMILY_SCAN, 0.5)], resolve_config(None))
    weights = DEFAULT_CONFIG["weights"]
    expected = round(100 * weights[FAMILY_SCAN] * 0.5 / sum(weights.values()))
    assert result.score == expected


def test_default_weights_cover_all_families():
    assert set(DEFAULT_CONFIG["weights"]) == set(FAMILIES)
    assert DEFAULT_CONFIG["configVersion"]


def test_config_override_changes_score_and_version():
    base = resolve_config(None)
    custom = resolve_config(ConfigOverride(weights={FAMILY_SCAN: 5.0}))
    indicators = [ind("A", FAMILY_SCAN, 0.5)]
    assert compute_risk(indicators, custom).score > compute_risk(indicators, base).score
    assert custom["configVersion"] != base["configVersion"]
    assert DEFAULT_CONFIG["weights"][FAMILY_SCAN] == 0.20  # default is never mutated


def test_threshold_override_moves_level_cutoffs():
    config = resolve_config(ConfigOverride(thresholds={"lowMax": 10, "mediumMax": 20, "highMax": 30}))
    assert classify_level(25, config["thresholds"]) == "HIGH"
    assert classify_level(31, config["thresholds"]) == "CRITICAL"


@pytest.mark.parametrize(
    "override",
    [
        ConfigOverride(weights={"bogus": 1.0}),
        ConfigOverride(weights={FAMILY_SCAN: -1.0}),
        ConfigOverride(weights={f: 0.0 for f in FAMILIES}),
        ConfigOverride(thresholds={"lowMax": 60}),
        ConfigOverride(thresholds={"nope": 1}),
        ConfigOverride(thresholds={"lowMax": 0}),
    ],
)
def test_invalid_config_rejected(override):
    with pytest.raises(ConfigError):
        resolve_config(override)


def test_empty_override_keeps_default_version():
    assert resolve_config(ConfigOverride())["configVersion"] == DEFAULT_CONFIG["configVersion"]


def test_chain_failure_floors_score_at_75():
    result = compute_risk([ind("CHAIN_VERIFICATION_FAILED", "chain_integrity", 1.0)], resolve_config(None))
    assert result.score >= 75 and result.level == "CRITICAL"
    assert "CHAIN_VERIFICATION_FAILED" in result.floors_applied


def test_revoked_qr_floors_score_at_75():
    result = compute_risk([ind("REVOKED_QR_SCANNED", "chain_integrity", 1.0)], resolve_config(None))
    assert result.level == "CRITICAL"


def test_expired_movement_floors_at_50_but_not_critical():
    result = compute_risk([ind("EXPIRED_BATCH_MOVEMENT", "expiry", 0.8)], resolve_config(None))
    assert result.score == 50 and result.level == "HIGH"


def test_strong_single_signal_is_not_diluted_below_high():
    result = compute_risk([ind("SCAN_BURST", FAMILY_SCAN, 1.0)], resolve_config(None))
    assert result.score == 50


def test_weak_signal_stays_low():
    assert compute_risk([ind("X", FAMILY_SCAN, 0.3)], resolve_config(None)).level == "LOW"


def test_floor_cannot_be_lowered_by_request_override():
    config = resolve_config(ConfigOverride(weights={FAMILY_ML: 100.0}))
    result = compute_risk([ind("CHAIN_VERIFICATION_FAILED", "chain_integrity", 1.0)], config)
    assert result.score >= 75


def test_unknown_family_rejected():
    with pytest.raises(ValueError):
        family_scores([ind("A", "mystery", 0.5)])


@pytest.mark.parametrize("signal,level", [(0.0, "LOW"), (0.3, "MEDIUM"), (0.6, "HIGH"), (0.9, "CRITICAL")])
def test_indicator_severity_cuts(signal, level):
    assert severity_for(signal) == level


def test_confidence_rises_with_corroboration_and_is_bounded():
    ctx = ctx_of(benign_payload())
    quiet = compute_confidence(ctx, {f: 0.0 for f in FAMILIES})
    corroborated = compute_confidence(ctx, {f: 0.9 for f in FAMILIES})
    assert 0.2 <= quiet < corroborated <= 1.0
