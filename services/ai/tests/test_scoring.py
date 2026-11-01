"""End-to-end scoring scenarios through score_request."""
from datetime import timedelta

import pytest

from app.ml import rows_to_frame, train_isolation_forest
from app.registry import ModelRegistry
from app.schemas import ScoreRequest
from app.scoring import ModelProvider, score_request
from app.synthetic import generate_rows
from app.constants import FEATURE_NAMES

from .conftest import DELHI, HYD, NOW, benign_payload, iso, scan


@pytest.fixture
def provider(tmp_path):
    return ModelProvider(ModelRegistry(tmp_path / "m"), "isolation_forest", "xgboost_supervised")


def run(payload, provider):
    return score_request(ScoreRequest.model_validate(payload), provider)


def codes(resp):
    return {i.code for i in resp.indicators}


def test_benign_context_is_low_with_no_rule_indicators(payload, provider):
    resp = run(payload, provider)
    assert resp.level == "LOW" and resp.riskScore == 0
    assert resp.indicators == []
    assert resp.category == "NORMAL"
    assert "normal verification" in resp.recommendedAction.lower()


def test_no_model_reports_rules_unsupervised_with_explicit_note(payload, provider):
    resp = run(payload, provider)
    assert resp.mode == "rules+unsupervised"
    assert any("No trained anomaly model" in n for n in resp.notes)
    assert resp.modelVersion.startswith("rules-")


def test_burst_scenario(payload, provider):
    payload["context"]["scans"] = [scan(NOW - timedelta(seconds=6 * i), device=f"d{i}") for i in range(100)]
    resp = run(payload, provider)
    assert "SCAN_BURST" in codes(resp)
    assert resp.level in {"HIGH", "CRITICAL"}


def test_impossible_travel_scenario(payload, provider):
    payload["context"]["scans"] = [scan(NOW - timedelta(minutes=2), HYD, "a"), scan(NOW, DELHI, "b")]
    resp = run(payload, provider)
    assert "IMPOSSIBLE_TRAVEL" in codes(resp)
    assert resp.category == "GEO_ANOMALY"


def test_invalid_receipt_scenario(payload, provider):
    payload["context"]["transfers"][0]["toOrg"] = "rogue"
    resp = run(payload, provider)
    assert "INVALID_TRANSITION" in codes(resp)
    assert resp.riskScore >= 50


def test_oversell_scenario(payload, provider):
    payload["context"]["batch"]["totalSold"] = 6000
    resp = run(payload, provider)
    assert "QUANTITY_INCONSISTENCY" in codes(resp)
    assert resp.category == "INVENTORY_DISCREPANCY"


def test_dormant_spike_scenario(payload, provider):
    payload["context"]["events"] = []
    old = scan(NOW - timedelta(days=90), device="old")
    payload["context"]["scans"] = [old] + [scan(NOW - timedelta(minutes=i), device=f"n{i}") for i in range(60)]
    assert "DORMANT_QR_SPIKE" in codes(run(payload, provider))


def test_expired_movement_scenario(payload, provider):
    payload["context"]["batch"]["expiryDate"] = iso(NOW - timedelta(days=10))
    payload["context"]["transfers"][0]["createdAt"] = iso(NOW - timedelta(days=1))
    resp = run(payload, provider)
    assert "EXPIRED_BATCH_MOVEMENT" in codes(resp)
    assert resp.riskScore >= 50


def test_chain_verification_failure_forces_critical(payload, provider):
    payload["context"]["chainVerified"] = False
    resp = run(payload, provider)
    assert resp.riskScore >= 75 and resp.level == "CRITICAL"
    assert any("Override floor" in n for n in resp.notes)
    assert "hold" in resp.recommendedAction.lower() and "PROPOSE" in resp.recommendedAction


def test_revoked_qr_scanned_forces_critical(payload, provider):
    payload["context"]["batch"]["qrStatus"] = "REVOKED"
    assert run(payload, provider).level == "CRITICAL"


def test_blocked_attempts_scenario(payload, provider):
    payload["context"]["blockedAttempts"] = [{"kind": "X", "at": iso(NOW), "actorOrg": "mfr"}] * 5
    assert "UNAUTHORIZED_ATTEMPTS" in codes(run(payload, provider))


def test_repeat_device_scenario(payload, provider):
    payload["context"]["scans"] = [scan(NOW - timedelta(hours=i), device="same") for i in range(30)]
    assert "REPEAT_DEVICE_SCANS" in codes(run(payload, provider))


def test_output_never_calls_product_counterfeit(payload, provider):
    payload["context"]["chainVerified"] = False
    resp = run(payload, provider)
    text = (resp.recommendedAction + " ".join(resp.notes) + resp.disclaimer).lower()
    assert "counterfeit" not in text and "fake" not in text
    assert "not a determination" in resp.recommendedAction


def test_scoring_is_deterministic(payload, provider):
    payload["context"]["batch"]["totalSold"] = 6000
    payload["context"]["scans"] = [scan(NOW - timedelta(seconds=6 * i), device=f"d{i}") for i in range(100)]
    first = run(payload, provider).model_dump()
    second = run(payload, provider).model_dump()
    assert first == second


def test_request_config_override_is_reflected(payload, provider):
    payload["context"]["batch"]["totalSold"] = 6000
    base = run(payload, provider)
    payload["config"] = {"weights": {"inventory": 10}}
    custom = run(payload, provider)
    assert custom.riskScore > base.riskScore
    assert custom.configVersion.endswith("+custom") and not base.configVersion.endswith("+custom")


def test_trained_model_is_used_and_synthetic_provenance_noted(payload, tmp_path):
    registry = ModelRegistry(tmp_path / "m")
    rows = generate_rows(120, 30, seed=1)
    bundle = train_isolation_forest(rows_to_frame([{k: r[k] for k in FEATURE_NAMES} for r in rows]))
    registry.save("isolation_forest", bundle, {"synthetic": True})
    resp = run(payload, ModelProvider(registry, "isolation_forest", "xgboost_supervised"))
    assert resp.mode == "rules+unsupervised"
    assert "ML_ANOMALY" in codes(resp)
    assert any("SYNTHETIC" in n for n in resp.notes)
    assert "isolation_forest/v1" in resp.modelVersion


def test_supervised_model_switches_mode(payload, tmp_path):
    xgboost = pytest.importorskip("xgboost")  # optional dependency; skipped only if not installed
    assert xgboost
    from app.ml import train_xgboost, validate_labels

    registry = ModelRegistry(tmp_path / "m")
    rows = generate_rows(120, 60, seed=2)
    frame = rows_to_frame([{k: r[k] for k in FEATURE_NAMES} for r in rows])
    bundle = train_xgboost(frame, validate_labels([r["label"] for r in rows], len(rows)))
    registry.save("xgboost_supervised", bundle, {"synthetic": True})
    resp = run(payload, ModelProvider(registry, "isolation_forest", "xgboost_supervised"))
    assert resp.mode == "hybrid-supervised"
    assert "ML_SUPERVISED" in codes(resp)


def test_provider_picks_up_new_version_and_drops_removed_model(tmp_path):
    registry = ModelRegistry(tmp_path / "m")
    provider = ModelProvider(registry, "isolation_forest", "xgboost_supervised")
    assert provider.unsupervised() is None
    rows = generate_rows(60, 10, seed=3)
    bundle = train_isolation_forest(rows_to_frame([{k: r[k] for k in FEATURE_NAMES} for r in rows]))
    registry.save("isolation_forest", bundle, {})
    assert provider.unsupervised()[1]["version"] == "v1"
    registry.save("isolation_forest", bundle, {})
    assert provider.unsupervised()[1]["version"] == "v2"
