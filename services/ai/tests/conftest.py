"""Shared fixtures and builders."""
from __future__ import annotations

import copy
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import compute_signature
from app.constants import ENV_MODELS_DIR, ENV_SHARED_SECRET, ENV_BIND_TIMESTAMP
from app.schemas import Context, ScoreRequest

NOW = datetime(2025, 6, 1, 12, 0, tzinfo=timezone.utc)
SECRET = "test-secret-not-for-production"
HYD = (17.385, 78.4867)
DELHI = (28.6139, 77.209)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def scan(at: datetime, loc: tuple[float, float] = HYD, device: str | None = "dev-1") -> dict[str, Any]:
    return {"scannedAt": iso(at), "lat": loc[0], "lon": loc[1], "deviceHash": device, "ipHash": "ip", "result": "VALID"}


def benign_payload() -> dict[str, Any]:
    scans = [scan(NOW - timedelta(days=d, hours=h), device=f"dev-{d}-{h}") for d, h in
             [(1, 3), (2, 7), (4, 1), (6, 9), (8, 2), (11, 5), (14, 8)]]
    return {
        "subject": {"type": "batch", "id": "b-1", "batchId": "b-1", "tenantId": "t-1"},
        "now": iso(NOW),
        "context": {
            "batch": {
                "initialQuantity": 5000,
                "expiryDate": iso(NOW + timedelta(days=300)),
                "status": "ACTIVE",
                "qrStatus": "ACTIVE",
                "totalSold": 1000,
                "totalTransferred": 3000,
                "holdings": [{"orgId": "dist-1", "quantity": 2000}, {"orgId": "ret-1", "quantity": 1000}],
            },
            "scans": scans,
            "transfers": [
                {"id": "tr-1", "fromOrg": "mfr", "toOrg": "dist-1", "quantity": 3000, "status": "ACCEPTED",
                 "createdAt": iso(NOW - timedelta(days=10)), "expectedToOrg": "dist-1"}
            ],
            "events": [{"type": "TRANSFER", "actorOrg": "mfr", "occurredAt": iso(NOW - timedelta(days=10)), "quantity": 3000}],
            "blockedAttempts": [],
            "actorHistory": {"mfr": {"priorAlerts": 0, "priorRiskAvg": 3}},
            "chainVerified": True,
        },
    }


@pytest.fixture
def payload() -> dict[str, Any]:
    return copy.deepcopy(benign_payload())


def ctx_of(data: dict[str, Any]) -> Context:
    return ScoreRequest.model_validate(data).context


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv(ENV_SHARED_SECRET, SECRET)
    monkeypatch.setenv(ENV_MODELS_DIR, str(tmp_path / "models"))
    monkeypatch.delenv(ENV_BIND_TIMESTAMP, raising=False)
    from app.main import app

    return TestClient(app)


def signed_headers(body: bytes, ts: float | None = None, secret: str = SECRET, bind: bool = False) -> dict[str, str]:
    stamp = str(int(ts if ts is not None else time.time()))
    sig = compute_signature(secret, body, stamp if bind else None)
    return {"X-Signature": sig, "X-Timestamp": stamp, "Content-Type": "application/json"}


def post_signed(client: TestClient, path: str, data: Any, **kw: Any):
    body = json.dumps(data).encode()
    return client.post(path, content=body, headers=signed_headers(body, **kw))
