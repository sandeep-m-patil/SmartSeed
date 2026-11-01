import json

import numpy as np
import pytest

from app.api_models import EvaluateRequest, TrainRequest
from app.constants import FEATURE_NAMES, MIN_TRAIN_ROWS
from app.drift import drift_status, feature_drift, psi
from app.ml import TrainingError, anomaly_signals, rows_to_frame, train_isolation_forest, validate_labels
from app.model_service import evaluate_model, train_model
from app.registry import ModelRegistry, RegistryError, validate_name
from app.synthetic import generate_rows


def feature_rows(n_benign=150, n_anom=40, seed=5):
    rows = generate_rows(n_benign, n_anom, seed)
    return rows, [{k: r[k] for k in FEATURE_NAMES} for r in rows]


def test_registry_versions_increment_and_load_roundtrip(tmp_path):
    registry = ModelRegistry(tmp_path)
    _, feats = feature_rows()
    bundle = train_isolation_forest(rows_to_frame(feats))
    assert registry.save("m", bundle, {"row_count": 1}) == "v1"
    assert registry.save("m", bundle, {"row_count": 2}) == "v2"
    assert registry.versions("m") == ["v1", "v2"]
    assert registry.latest_version("m") == "v2"
    loaded, manifest = registry.load("m")
    assert manifest["version"] == "v2" and manifest["row_count"] == 2
    frame = rows_to_frame(feats)
    assert np.allclose(anomaly_signals(loaded, frame), anomaly_signals(bundle, frame))
    assert registry.load("m", "v1")[1]["row_count"] == 1


def test_registry_missing_and_listing(tmp_path):
    registry = ModelRegistry(tmp_path / "nothing")
    assert registry.load("m") is None
    assert registry.list_models() == []
    assert registry.versions("m") == []
    assert registry.load("m", "v9") is None


def test_registry_listing_contains_manifest(tmp_path):
    registry = ModelRegistry(tmp_path)
    _, feats = feature_rows()
    registry.save("m", train_isolation_forest(rows_to_frame(feats)), {"synthetic": True})
    (tmp_path / "BadName").mkdir()
    [entry] = registry.list_models()
    assert entry["name"] == "m" and entry["latest"]["synthetic"] is True


@pytest.mark.parametrize("name", ["../evil", "A", "", "a/b", "x" * 80, ".hidden"])
def test_invalid_model_names_rejected(name):
    with pytest.raises(RegistryError):
        validate_name(name)


def test_invalid_version_rejected(tmp_path):
    with pytest.raises(RegistryError):
        ModelRegistry(tmp_path).manifest("m", "../../x")


def test_registry_save_cleans_up_on_failure(tmp_path):
    registry = ModelRegistry(tmp_path)
    with pytest.raises(TypeError):
        registry.save("m", {"x": 1}, {"bad": object()})
    assert registry.versions("m") == []
    assert list((tmp_path / "m").iterdir()) == []


def test_train_isolation_forest_manifest_has_no_fabricated_metrics(tmp_path):
    registry = ModelRegistry(tmp_path)
    _, feats = feature_rows()
    req = TrainRequest(rows=feats, dataDescription="SYNTHETIC test rows", synthetic=True)
    manifest = train_model(registry, "iforest", req)
    assert manifest["metrics"] is None
    assert manifest["synthetic"] is True and "SYNTHETIC" in manifest["synthetic_warning"]
    assert manifest["row_count"] == len(feats) and manifest["features"] == list(FEATURE_NAMES)
    assert manifest["trained_at"] and manifest["data_description"]
    on_disk = json.loads((tmp_path / "iforest" / "v1" / "manifest.json").read_text())
    assert on_disk["version"] == "v1"


def test_non_synthetic_manifest_has_no_warning(tmp_path):
    _, feats = feature_rows()
    manifest = train_model(ModelRegistry(tmp_path), "m", TrainRequest(rows=feats, dataDescription="real"))
    assert manifest["synthetic"] is False and manifest["synthetic_warning"] is None


def test_anomalous_rows_get_higher_signal_than_benign_on_average():
    rows, feats = feature_rows(300, 60)
    bundle = train_isolation_forest(rows_to_frame(feats))
    signals = anomaly_signals(bundle, rows_to_frame(feats))
    labels = np.array([r["label"] for r in rows])
    assert signals[labels == 1].mean() > signals[labels == 0].mean()
    assert signals.min() >= 0 and signals.max() <= 1


def test_training_input_validation():
    with pytest.raises(TrainingError):
        rows_to_frame([])
    with pytest.raises(TrainingError):
        rows_to_frame([{"scan_count": 1.0}])
    bad = [{k: 1.0 for k in FEATURE_NAMES}]
    bad[0]["scan_count"] = float("nan")
    with pytest.raises(TrainingError):
        rows_to_frame(bad)
    _, feats = feature_rows()
    with pytest.raises(TrainingError):
        train_isolation_forest(rows_to_frame(feats[: MIN_TRAIN_ROWS - 1]))


def test_label_validation():
    with pytest.raises(TrainingError):
        validate_labels([0, 1], 3)
    with pytest.raises(TrainingError):
        validate_labels([0, 2] * 100, 200)
    with pytest.raises(TrainingError):
        validate_labels([0, 1] * 10, 20)
    with pytest.raises(TrainingError):
        validate_labels([0] * 190 + [1] * 10, 200)
    assert len(validate_labels([0, 1] * 60, 120)) == 120


def test_labels_without_enough_data_gives_clear_error(tmp_path):
    _, feats = feature_rows(20, 10)
    req = TrainRequest(rows=feats, labels=[0] * 20 + [1] * 10, dataDescription="tiny")
    with pytest.raises(TrainingError, match="labelled rows"):
        train_model(ModelRegistry(tmp_path), "sup", req)


def test_supervised_training_computes_real_holdout_metrics(tmp_path):
    pytest.importorskip("xgboost")  # optional dependency; skipped only if not installed
    rows, feats = feature_rows(220, 80)
    req = TrainRequest(rows=feats, labels=[r["label"] for r in rows], dataDescription="SYNTHETIC", synthetic=True)
    manifest = train_model(ModelRegistry(tmp_path), "sup", req)
    assert manifest["algorithm"] == "xgboost"
    assert 0.0 <= manifest["metrics"]["roc_auc"] <= 1.0
    assert manifest["metrics"]["holdout_rows"] >= 20
    assert "holdout" in manifest["metrics_note"]


def test_evaluate_unlabelled_returns_summary_only(tmp_path):
    registry = ModelRegistry(tmp_path)
    _, feats = feature_rows()
    train_model(registry, "m", TrainRequest(rows=feats, dataDescription="d", synthetic=True))
    result = evaluate_model(registry, "m", EvaluateRequest(rows=feats, synthetic=True))
    assert result["metrics"] is None and "No labels" in result["metricsNote"]
    assert result["syntheticWarning"] and result["summary"]["rows"] == len(feats)


def test_evaluate_labelled_computes_metrics_and_validates(tmp_path):
    registry = ModelRegistry(tmp_path)
    rows, feats = feature_rows()
    train_model(registry, "m", TrainRequest(rows=feats, dataDescription="d"))
    labels = [r["label"] for r in rows]
    result = evaluate_model(registry, "m", EvaluateRequest(rows=feats, labels=labels))
    assert 0 <= result["metrics"]["roc_auc"] <= 1 and result["syntheticWarning"] is None
    with pytest.raises(TrainingError):
        evaluate_model(registry, "m", EvaluateRequest(rows=feats, labels=[0] * len(feats)))
    with pytest.raises(TrainingError):
        evaluate_model(registry, "m", EvaluateRequest(rows=feats, labels=[0, 1]))
    assert evaluate_model(registry, "absent", EvaluateRequest(rows=feats)) is None


def test_psi_identical_is_zero_and_shift_is_significant():
    rng = np.random.default_rng(0)
    ref = rng.normal(0, 1, 2000)
    assert psi(ref, ref.copy(), 10) < 0.01
    shifted = rng.normal(2, 1, 2000)
    assert psi(ref, shifted, 10) > 0.25


def test_psi_constant_reference_and_empty_input():
    assert psi(np.ones(50), np.ones(50), 10) == pytest.approx(0, abs=1e-6)
    assert psi(np.ones(50), np.zeros(50), 10) > 0.25
    with pytest.raises(ValueError):
        psi(np.array([]), np.ones(3), 10)


def test_feature_drift_report_and_status():
    ref = [{"a": float(i), "b": 1.0} for i in range(100)]
    cur = [{"a": float(i) + 80, "b": 1.0} for i in range(100)]
    report = feature_drift(ref, cur, ["a", "b"], 10)
    assert report["a"]["status"] == "significant" and report["b"]["status"] == "stable"
    with pytest.raises(ValueError):
        feature_drift(ref, cur, ["missing"], 10)
    assert [drift_status(v) for v in (0.05, 0.15, 0.3)] == ["stable", "moderate", "significant"]


def test_synthetic_generator_is_deterministic_and_labelled():
    first = generate_rows(10, 10, seed=9)
    assert first == generate_rows(10, 10, seed=9)
    assert {r["origin"] for r in first} == {"SYNTHETIC"}
    assert {r["kind"] for r in first} >= {"benign", "burst", "travel", "oversell", "dormant", "expired"}
