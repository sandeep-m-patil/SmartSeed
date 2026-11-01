"""Deterministic supply-chain, inventory, expiry and actor rule detectors."""
from __future__ import annotations

from datetime import datetime

from .constants import (
    ACTOR_HISTORY_MAX_SIGNAL,
    ACTOR_MIN_SIGNAL,
    BLOCKED_FULL_COUNT,
    EXPIRED_MOVEMENT_SIGNAL,
    FAMILY_ACTOR,
    FAMILY_CHAIN,
    FAMILY_EXPIRY,
    FAMILY_INVENTORY,
    INACTIVE_TRANSFER_STATUSES,
    INVALID_TRANSITION_SIGNAL,
    MAX_SCORE,
    MOVEMENT_EVENT_KEYWORDS,
    PRIOR_ALERTS_FULL,
    QUANTITY_BASE_SIGNAL,
    QUANTITY_EXCESS_GAIN,
)
from .indicators import Detection, clamp01, make_detection
from .schemas import Context, Evidence

CODE_CHAIN_FAILED = "CHAIN_VERIFICATION_FAILED"
CODE_REVOKED_SCANNED = "REVOKED_QR_SCANNED"
CODE_EXPIRED_MOVED = "EXPIRED_BATCH_MOVEMENT"


def detect_invalid_transition(ctx: Context, now: datetime) -> list[Detection]:
    bad = [
        t for t in ctx.transfers if t.expectedToOrg is not None and t.toOrg != t.expectedToOrg
    ]
    if not bad:
        return []
    evidence = [
        Evidence(
            kind="transfer",
            ref=t.id,
            detail=f"received by {t.toOrg}, dispatched to {t.expectedToOrg}",
        )
        for t in bad
    ]
    desc = f"{len(bad)} transfer(s) reached an organisation that was not the dispatch target."
    return [make_detection("INVALID_TRANSITION", FAMILY_CHAIN, INVALID_TRANSITION_SIGNAL, desc, evidence)]


def detect_quantity(ctx: Context, now: datetime) -> list[Detection]:
    batch = ctx.batch
    held = sum(h.quantity for h in batch.holdings)
    checks = {"sold": batch.totalSold, "transferred": batch.totalTransferred, "held": held}
    over = {k: v for k, v in checks.items() if v > batch.initialQuantity}
    if not over:
        return []
    base = max(batch.initialQuantity, 1.0)
    excess = max(over.values()) - batch.initialQuantity
    signal = QUANTITY_BASE_SIGNAL + QUANTITY_EXCESS_GAIN * (excess / base)
    detail = ", ".join(f"{k}={v:g}" for k, v in over.items()) + f" exceed initial quantity {batch.initialQuantity:g}."
    evidence = [Evidence(kind="batch_quantity", ref=k, detail=f"{k}={v:g}") for k, v in over.items()]
    return [make_detection("QUANTITY_INCONSISTENCY", FAMILY_INVENTORY, signal, detail, evidence)]


def _is_movement_event(event_type: str) -> bool:
    lowered = event_type.lower()
    return any(word in lowered for word in MOVEMENT_EVENT_KEYWORDS)


def detect_expired_movement(ctx: Context, now: datetime) -> list[Detection]:
    expiry = ctx.batch.expiryDate
    if expiry is None or expiry >= now:
        return []
    evidence = [
        Evidence(kind="transfer", ref=t.id, detail=f"created {t.createdAt.isoformat()} after expiry")
        for t in ctx.transfers
        if t.createdAt > expiry and t.status.upper() not in INACTIVE_TRANSFER_STATUSES
    ]
    evidence += [
        Evidence(kind="event", ref=e.type, detail=f"occurred {e.occurredAt.isoformat()} after expiry")
        for e in ctx.events
        if e.occurredAt > expiry and _is_movement_event(e.type)
    ]
    if not evidence:
        return []
    desc = f"Expired batch (expired {expiry.date().isoformat()}) shows {len(evidence)} movement record(s)."
    return [make_detection(CODE_EXPIRED_MOVED, FAMILY_EXPIRY, EXPIRED_MOVEMENT_SIGNAL, desc, evidence)]


def detect_blocked_attempts(ctx: Context, now: datetime) -> list[Detection]:
    count = len(ctx.blockedAttempts)
    if count == 0:
        return []
    evidence = [
        Evidence(kind="blocked_attempt", ref=b.actorOrg or "unknown", detail=f"{b.kind} at {b.at.isoformat()}")
        for b in ctx.blockedAttempts[:BLOCKED_FULL_COUNT]
    ]
    desc = f"{count} blocked/unauthorised attempt(s) recorded."
    return [make_detection("UNAUTHORIZED_ATTEMPTS", FAMILY_ACTOR, count / BLOCKED_FULL_COUNT, desc, evidence)]


def detect_revoked_scanned(ctx: Context, now: datetime) -> list[Detection]:
    if ctx.batch.qrStatus.upper() != "REVOKED" or not ctx.scans:
        return []
    desc = f"Revoked QR was scanned {len(ctx.scans)} time(s)."
    evidence = [Evidence(kind="qr_status", ref="REVOKED", detail=desc)]
    return [make_detection(CODE_REVOKED_SCANNED, FAMILY_CHAIN, 1.0, desc, evidence)]


def detect_chain_failure(ctx: Context, now: datetime) -> list[Detection]:
    if ctx.chainVerified is not False:
        return []
    desc = "Ledger verification of this record failed."
    evidence = [Evidence(kind="chain_verification", ref="chainVerified", detail="false")]
    return [make_detection(CODE_CHAIN_FAILED, FAMILY_CHAIN, 1.0, desc, evidence)]


def _involved_orgs(ctx: Context) -> set[str]:
    orgs = {t.fromOrg for t in ctx.transfers} | {t.toOrg for t in ctx.transfers}
    orgs |= {e.actorOrg for e in ctx.events if e.actorOrg}
    orgs |= {b.actorOrg for b in ctx.blockedAttempts if b.actorOrg}
    return orgs


def detect_actor_history(ctx: Context, now: datetime) -> list[Detection]:
    scored: list[tuple[float, str]] = []
    for org in sorted(_involved_orgs(ctx)):
        hist = ctx.actorHistory.get(org)
        if hist is None:
            continue
        signal = max(hist.priorAlerts / PRIOR_ALERTS_FULL, hist.priorRiskAvg / MAX_SCORE)
        scored.append((min(clamp01(signal), ACTOR_HISTORY_MAX_SIGNAL), org))
    if not scored:
        return []
    signal, org = max(scored)
    if signal < ACTOR_MIN_SIGNAL:
        return []
    hist = ctx.actorHistory[org]
    detail = f"{org}: {hist.priorAlerts} prior alert(s), average prior risk {hist.priorRiskAvg:g}."
    return [make_detection("ACTOR_HISTORY_RISK", FAMILY_ACTOR, signal, detail, [Evidence(kind="actor", ref=org, detail=detail)])]


CHAIN_DETECTORS = (
    detect_invalid_transition,
    detect_quantity,
    detect_expired_movement,
    detect_blocked_attempts,
    detect_revoked_scanned,
    detect_chain_failure,
    detect_actor_history,
)
