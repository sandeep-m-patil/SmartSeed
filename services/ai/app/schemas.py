"""Pydantic request/response models for /v1/score."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from .constants import MAX_SCANS_PER_CONTEXT

Level = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class UtcModel(BaseModel):
    """Base that normalises every datetime field to aware UTC."""

    @field_validator("*", mode="after")
    @classmethod
    def _normalise_dt(cls, value: Any) -> Any:
        return _to_utc(value) if isinstance(value, datetime) else value


class Subject(UtcModel):
    type: Literal["qr", "batch", "transfer"]
    id: str
    batchId: str
    tenantId: str


class Holding(UtcModel):
    orgId: str
    quantity: float = Field(ge=0)


class BatchContext(UtcModel):
    initialQuantity: float = Field(ge=0)
    expiryDate: datetime | None = None
    status: str = ""
    qrStatus: str = ""
    totalSold: float = Field(default=0, ge=0)
    totalTransferred: float = Field(default=0, ge=0)
    holdings: list[Holding] = Field(default_factory=list)


class Scan(UtcModel):
    scannedAt: datetime
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    deviceHash: str | None = None
    ipHash: str | None = None
    result: str | None = None


class Transfer(UtcModel):
    id: str
    fromOrg: str
    toOrg: str
    quantity: float = Field(ge=0)
    status: str
    createdAt: datetime
    expectedToOrg: str | None = None


class Event(UtcModel):
    type: str
    actorOrg: str | None = None
    occurredAt: datetime
    quantity: float | None = None


class BlockedAttempt(UtcModel):
    kind: str
    at: datetime
    actorOrg: str | None = None


class ActorHistoryEntry(UtcModel):
    priorAlerts: int = Field(default=0, ge=0)
    priorRiskAvg: float = Field(default=0, ge=0, le=100)


class Context(UtcModel):
    batch: BatchContext
    scans: list[Scan] = Field(default_factory=list, max_length=MAX_SCANS_PER_CONTEXT)
    transfers: list[Transfer] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    blockedAttempts: list[BlockedAttempt] = Field(default_factory=list)
    actorHistory: dict[str, ActorHistoryEntry] = Field(default_factory=dict)
    chainVerified: bool | None = None


class ConfigOverride(BaseModel):
    weights: dict[str, float] | None = None
    thresholds: dict[str, int] | None = None


class ScoreRequest(UtcModel):
    subject: Subject
    now: datetime
    context: Context
    config: ConfigOverride | None = None


class Indicator(BaseModel):
    code: str
    family: str
    severity: Level
    normalizedSignal: float = Field(ge=0, le=1)
    description: str


class Evidence(BaseModel):
    kind: str
    ref: str
    detail: str


class ScoreResponse(BaseModel):
    riskScore: int = Field(ge=0, le=100)
    level: Level
    category: str
    severity: Level
    indicators: list[Indicator]
    confidence: float = Field(ge=0, le=1)
    evidence: list[Evidence]
    recommendedAction: str
    modelVersion: str
    mode: Literal["rules+unsupervised", "hybrid-supervised"]
    componentScores: dict[str, float]
    configVersion: str
    notes: list[str] = Field(default_factory=list)
    disclaimer: str
