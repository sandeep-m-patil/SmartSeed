"""Environment-driven settings. Read at call time so tests can monkeypatch env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .constants import (
    DEFAULT_MODELS_DIR,
    DEFAULT_SUPERVISED_MODEL,
    DEFAULT_UNSUPERVISED_MODEL,
    ENV_BIND_TIMESTAMP,
    ENV_MODELS_DIR,
    ENV_SHARED_SECRET,
    ENV_SUPERVISED_MODEL,
    ENV_UNSUPERVISED_MODEL,
)

TRUTHY = frozenset({"1", "true", "yes", "on"})


@dataclass(frozen=True)
class Settings:
    shared_secret: str | None
    models_dir: Path
    unsupervised_model: str
    supervised_model: str
    should_bind_timestamp: bool


def get_settings() -> Settings:
    return Settings(
        shared_secret=os.environ.get(ENV_SHARED_SECRET) or None,
        models_dir=Path(os.environ.get(ENV_MODELS_DIR, DEFAULT_MODELS_DIR)),
        unsupervised_model=os.environ.get(ENV_UNSUPERVISED_MODEL, DEFAULT_UNSUPERVISED_MODEL),
        supervised_model=os.environ.get(ENV_SUPERVISED_MODEL, DEFAULT_SUPERVISED_MODEL),
        should_bind_timestamp=os.environ.get(ENV_BIND_TIMESTAMP, "").lower() in TRUTHY,
    )
