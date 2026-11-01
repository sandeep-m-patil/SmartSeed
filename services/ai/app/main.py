"""FastAPI application. All /v1 routes require an HMAC signature (see auth.py)."""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Awaitable, Callable, TypeVar

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from .api_models import DriftRequest, EvaluateRequest, TrainRequest
from .auth import require_signature
from .constants import FEATURE_NAMES, RULES_VERSION, SERVICE_NAME, SYNTHETIC_WARNING
from .drift import feature_drift
from .logging_setup import configure_logging
from .ml import TrainingError
from .model_service import evaluate_model, train_model
from .registry import ModelRegistry, RegistryError
from .risk_engine import ConfigError
from .schemas import ScoreRequest, ScoreResponse
from .scoring import ModelProvider, score_request
from .settings import get_settings

logger = logging.getLogger(SERVICE_NAME)
M = TypeVar("M", bound=BaseModel)
_providers: dict[tuple[str, str, str], ModelProvider] = {}

configure_logging()
app = FastAPI(title="SmartSeed AI service", version="0.1.0")


def get_registry() -> ModelRegistry:
    return ModelRegistry(get_settings().models_dir)


def get_provider() -> ModelProvider:
    s = get_settings()
    key = (str(s.models_dir), s.unsupervised_model, s.supervised_model)
    if key not in _providers:
        _providers[key] = ModelProvider(ModelRegistry(s.models_dir), s.unsupervised_model, s.supervised_model)
    return _providers[key]


def parse_body(model: type[M], raw: bytes) -> M:
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=exc.errors(include_url=False, include_context=False, include_input=False)
        ) from None


@app.middleware("http")
async def log_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    logger.info(
        "request",
        extra={
            "requestId": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
        },
    )
    return response


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "validation failed"
    details = None if isinstance(exc.detail, str) else exc.detail
    body = {"error": {"code": exc.status_code, "message": message, "details": details}}
    return JSONResponse(status_code=exc.status_code, content=body)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE_NAME, "rulesVersion": RULES_VERSION}


@app.post("/v1/score", response_model=ScoreResponse)
def score(raw: bytes = Depends(require_signature)) -> ScoreResponse:
    req = parse_body(ScoreRequest, raw)
    try:
        return score_request(req, get_provider())
    except ConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@app.get("/v1/models")
def list_models(_: bytes = Depends(require_signature)) -> dict[str, Any]:
    models = get_registry().list_models()
    return {
        "models": models,
        "featureNames": list(FEATURE_NAMES),
        "note": "Manifests with synthetic=true describe SYNTHETIC training data only.",
    }


@app.post("/v1/models/{name}/evaluate")
def evaluate(name: str, raw: bytes = Depends(require_signature)) -> dict[str, Any]:
    req = parse_body(EvaluateRequest, raw)
    try:
        result = evaluate_model(get_registry(), name, req)
    except (TrainingError, RegistryError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if result is None:
        raise HTTPException(status_code=404, detail=f"model {name!r} not found")
    return result


@app.post("/v1/models/{name}/train", status_code=201)
def train(name: str, raw: bytes = Depends(require_signature)) -> dict[str, Any]:
    req = parse_body(TrainRequest, raw)
    try:
        manifest = train_model(get_registry(), name, req)
    except (TrainingError, RegistryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"manifest": manifest, "syntheticWarning": SYNTHETIC_WARNING if req.synthetic else None}


@app.post("/v1/drift")
def drift(raw: bytes = Depends(require_signature)) -> dict[str, Any]:
    req = parse_body(DriftRequest, raw)
    features = req.features or list(FEATURE_NAMES)
    try:
        report = feature_drift(req.reference, req.current, features, req.bins)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"features": report, "referenceRows": len(req.reference), "currentRows": len(req.current)}
