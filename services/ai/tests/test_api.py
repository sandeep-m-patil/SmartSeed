import json
import logging
import time

import pytest

from app.constants import FEATURE_NAMES
from app.synthetic import generate_rows

from .conftest import NOW, SECRET, benign_payload, post_signed, signed_headers


def body_of(data):
    return json.dumps(data).encode()


def test_healthz_needs_no_auth(client):
    assert client.get("/healthz").json()["status"] == "ok"


def test_valid_signature_accepted(client):
    resp = post_signed(client, "/v1/score", benign_payload())
    assert resp.status_code == 200
    data = resp.json()
    assert data["level"] == "LOW" and data["mode"] == "rules+unsupervised"
    assert set(data) >= {"riskScore", "level", "category", "severity", "indicators", "confidence", "evidence",
                         "recommendedAction", "modelVersion", "mode", "componentScores", "configVersion"}


def test_invalid_signature_rejected(client):
    body = body_of(benign_payload())
    headers = signed_headers(body, secret="wrong-secret")
    resp = client.post("/v1/score", content=body, headers=headers)
    assert resp.status_code == 401 and resp.json()["error"]["message"] == "unauthorized"


def test_tampered_body_rejected(client):
    body = body_of(benign_payload())
    headers = signed_headers(body)
    assert client.post("/v1/score", content=body + b" ", headers=headers).status_code == 401


def test_stale_timestamp_rejected_even_with_valid_signature(client):
    resp = post_signed(client, "/v1/score", benign_payload(), ts=time.time() - 301)
    assert resp.status_code == 401


def test_future_timestamp_outside_window_rejected(client):
    assert post_signed(client, "/v1/score", benign_payload(), ts=time.time() + 600).status_code == 401


def test_timestamp_just_inside_window_accepted(client):
    assert post_signed(client, "/v1/score", benign_payload(), ts=time.time() - 240).status_code == 200


def test_missing_or_malformed_headers_rejected(client):
    body = body_of(benign_payload())
    assert client.post("/v1/score", content=body).status_code == 401
    good = signed_headers(body)
    assert client.post("/v1/score", content=body, headers={**good, "X-Timestamp": "garbage"}).status_code == 401
    no_ts = {k: v for k, v in good.items() if k != "X-Timestamp"}
    assert client.post("/v1/score", content=body, headers=no_ts).status_code == 401
    assert client.post("/v1/score", content=body, headers={**good, "X-Signature": ""}).status_code == 401


def test_iso_timestamp_accepted(client):
    from datetime import datetime, timezone
    from app.auth import compute_signature

    body = body_of(benign_payload())
    stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    headers = {"X-Signature": compute_signature(SECRET, body), "X-Timestamp": stamp}
    assert client.post("/v1/score", content=body, headers=headers).status_code == 200


def test_every_v1_route_requires_auth(client):
    assert client.get("/v1/models").status_code == 401
    for path in ("/v1/score", "/v1/drift", "/v1/models/m/train", "/v1/models/m/evaluate"):
        assert client.post(path, json={}).status_code == 401


def test_missing_server_secret_fails_closed(client, monkeypatch):
    monkeypatch.delenv("AI_SHARED_SECRET")
    assert post_signed(client, "/v1/score", benign_payload(), secret="anything").status_code == 401


def test_timestamp_binding_mode(client, monkeypatch):
    monkeypatch.setenv("AI_SIGN_TIMESTAMP", "true")
    assert post_signed(client, "/v1/score", benign_payload(), bind=True).status_code == 200
    assert post_signed(client, "/v1/score", benign_payload(), bind=False).status_code == 401


def test_auth_checked_before_body_validation(client):
    resp = client.post("/v1/score", content=b"not json")
    assert resp.status_code == 401


def test_invalid_body_returns_422_with_details(client):
    resp = post_signed(client, "/v1/score", {"subject": {}})
    assert resp.status_code == 422 and resp.json()["error"]["details"]


def test_invalid_config_returns_422(client):
    data = benign_payload()
    data["config"] = {"weights": {"nope": 1}}
    assert post_signed(client, "/v1/score", data).status_code == 422


def test_score_reflects_chain_failure_over_http(client):
    data = benign_payload()
    data["context"]["chainVerified"] = False
    assert post_signed(client, "/v1/score", data).json()["riskScore"] >= 75


def test_models_listing_empty_then_populated_and_train_flow(client):
    assert client.get("/v1/models", headers=signed_headers(b"")).json()["models"] == []
    rows = [{k: r[k] for k in FEATURE_NAMES} for r in generate_rows(120, 30, 3)]
    resp = post_signed(client, "/v1/models/isolation_forest/train",
                       {"rows": rows, "dataDescription": "SYNTHETIC", "synthetic": True})
    assert resp.status_code == 201
    assert resp.json()["manifest"]["version"] == "v1" and resp.json()["syntheticWarning"]
    listing = client.get("/v1/models", headers=signed_headers(b"")).json()["models"]
    assert listing[0]["name"] == "isolation_forest"
    scored = post_signed(client, "/v1/score", benign_payload()).json()
    assert "isolation_forest/v1" in scored["modelVersion"]
    assert any("SYNTHETIC" in n for n in scored["notes"])


def test_train_errors_are_400_with_clear_message(client):
    rows = [{k: 1.0 for k in FEATURE_NAMES}] * 5
    resp = post_signed(client, "/v1/models/m/train", {"rows": rows, "dataDescription": "d"})
    assert resp.status_code == 400 and "rows are required" in resp.json()["error"]["message"]
    resp = post_signed(client, "/v1/models/m/train", {"rows": rows, "labels": [0] * 5, "dataDescription": "d"})
    assert resp.status_code == 400 and "labelled" in resp.json()["error"]["message"]
    assert post_signed(client, "/v1/models/BAD NAME/train", {"rows": rows, "dataDescription": "d"}).status_code == 400


def test_evaluate_endpoint(client):
    rows = [{k: r[k] for k in FEATURE_NAMES} for r in generate_rows(120, 30, 4)]
    assert post_signed(client, "/v1/models/m/evaluate", {"rows": rows}).status_code == 404
    post_signed(client, "/v1/models/m/train", {"rows": rows, "dataDescription": "d", "synthetic": True})
    resp = post_signed(client, "/v1/models/m/evaluate", {"rows": rows, "synthetic": True})
    assert resp.status_code == 200 and resp.json()["metrics"] is None and resp.json()["syntheticWarning"]
    bad = post_signed(client, "/v1/models/m/evaluate", {"rows": rows, "labels": [1]})
    assert bad.status_code == 400


def test_drift_endpoint(client):
    ref = [{"a": float(i)} for i in range(100)]
    cur = [{"a": float(i) + 90} for i in range(100)]
    resp = post_signed(client, "/v1/drift", {"reference": ref, "current": cur, "features": ["a"]})
    assert resp.json()["features"]["a"]["status"] == "significant"
    assert post_signed(client, "/v1/drift", {"reference": [], "current": cur, "features": ["a"]}).status_code == 400


def test_drift_defaults_to_model_features(client):
    row = {k: 1.0 for k in FEATURE_NAMES}
    resp = post_signed(client, "/v1/drift", {"reference": [row] * 5, "current": [row] * 5})
    assert set(resp.json()["features"]) == set(FEATURE_NAMES)


def test_logs_are_json_and_never_contain_secret(client, capfd, caplog):
    caplog.set_level(logging.INFO)
    post_signed(client, "/v1/score", benign_payload(), secret="bad-secret-xyz")
    out = capfd.readouterr().out
    assert "bad-secret-xyz" not in out and SECRET not in out
    from app.logging_setup import JsonFormatter

    record = logging.LogRecord("x", logging.INFO, "f", 1, "hello %s", ("w",), None)
    record.requestId = "r1"
    parsed = json.loads(JsonFormatter().format(record))
    assert parsed["message"] == "hello w" and parsed["requestId"] == "r1"


def test_json_formatter_includes_exceptions():
    from app.logging_setup import JsonFormatter

    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = logging.LogRecord("x", logging.ERROR, "f", 1, "failed", (), sys.exc_info())
    assert "boom" in json.loads(JsonFormatter().format(record))["exc"]
