"""Request models for model management and drift endpoints."""
from __future__ import annotations

from pydantic import BaseModel, Field

from .constants import MAX_ROWS_PER_REQUEST, PSI_BINS


class TrainRequest(BaseModel):
    rows: list[dict[str, float]] = Field(max_length=MAX_ROWS_PER_REQUEST)
    labels: list[int] | None = None
    dataDescription: str = Field(min_length=1, max_length=2000)
    synthetic: bool = False


class EvaluateRequest(BaseModel):
    rows: list[dict[str, float]] = Field(max_length=MAX_ROWS_PER_REQUEST)
    labels: list[int] | None = None
    version: str | None = None
    dataDescription: str = Field(default="unspecified", max_length=2000)
    synthetic: bool = False


class DriftRequest(BaseModel):
    reference: list[dict[str, float]] = Field(max_length=MAX_ROWS_PER_REQUEST)
    current: list[dict[str, float]] = Field(max_length=MAX_ROWS_PER_REQUEST)
    features: list[str] | None = None
    bins: int = Field(default=PSI_BINS, ge=2, le=100)
