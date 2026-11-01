"""HMAC-SHA256 request authentication for /v1 routes."""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from .constants import SIGNATURE_HEADER, TIMESTAMP_HEADER, TIMESTAMP_TOLERANCE_SECONDS
from .settings import get_settings

logger = logging.getLogger(__name__)


def compute_signature(secret: str, body: bytes, timestamp: str | None = None) -> str:
    """Hex HMAC-SHA256 of the raw body (optionally bound to the timestamp)."""
    message = body if timestamp is None else timestamp.encode() + b"." + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def parse_timestamp(raw: str) -> float:
    """Accept epoch seconds or ISO-8601; returns epoch seconds."""
    try:
        return float(raw)
    except ValueError:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()


def _unauthorized(reason: str) -> HTTPException:
    logger.warning("auth_rejected", extra={"reason": reason})
    return HTTPException(status_code=401, detail="unauthorized")


def _check_timestamp(raw: str | None) -> str:
    if not raw:
        raise _unauthorized("missing_timestamp")
    try:
        sent_at = parse_timestamp(raw)
    except ValueError:
        raise _unauthorized("bad_timestamp") from None
    skew = abs(datetime.now(timezone.utc).timestamp() - sent_at)
    if skew > TIMESTAMP_TOLERANCE_SECONDS:
        raise _unauthorized("stale_timestamp")
    return raw


async def require_signature(request: Request) -> bytes:
    """FastAPI dependency: verifies headers and returns the raw body."""
    settings = get_settings()
    if settings.shared_secret is None:
        logger.error("auth_unconfigured")
        raise HTTPException(status_code=401, detail="unauthorized")
    timestamp = _check_timestamp(request.headers.get(TIMESTAMP_HEADER))
    signature = request.headers.get(SIGNATURE_HEADER, "")
    body = await request.body()
    bound = timestamp if settings.should_bind_timestamp else None
    expected = compute_signature(settings.shared_secret, body, bound)
    if not hmac.compare_digest(expected.encode(), signature.lower().encode()):
        raise _unauthorized("bad_signature")
    return body
