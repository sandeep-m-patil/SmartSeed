"""Indicator construction shared by rule and statistical detectors."""
from __future__ import annotations

from dataclasses import dataclass, field

from .constants import LEVEL_CRITICAL, LEVEL_HIGH, LEVEL_LOW, LEVEL_MEDIUM
from .schemas import Evidence, Indicator, Level

SEVERITY_CUTS: tuple[tuple[float, Level], ...] = (
    (0.75, LEVEL_CRITICAL),
    (0.5, LEVEL_HIGH),
    (0.25, LEVEL_MEDIUM),
)


@dataclass(frozen=True)
class Detection:
    indicator: Indicator
    evidence: list[Evidence] = field(default_factory=list)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def severity_for(signal: float) -> Level:
    for cut, level in SEVERITY_CUTS:
        if signal >= cut:
            return level
    return LEVEL_LOW


def make_detection(
    code: str,
    family: str,
    signal: float,
    description: str,
    evidence: list[Evidence] | None = None,
) -> Detection:
    value = round(clamp01(signal), 4)
    indicator = Indicator(
        code=code,
        family=family,
        severity=severity_for(value),
        normalizedSignal=value,
        description=description,
    )
    return Detection(indicator, evidence or [])
