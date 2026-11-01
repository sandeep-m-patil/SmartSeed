from datetime import timedelta

from app.detectors_chain import (
    detect_actor_history,
    detect_blocked_attempts,
    detect_chain_failure,
    detect_expired_movement,
    detect_invalid_transition,
    detect_quantity,
    detect_revoked_scanned,
)

from .conftest import NOW, benign_payload, ctx_of


def _ctx(mutator):
    data = benign_payload()
    mutator(data["context"])
    return ctx_of(data)


def _noop(c):
    return None


def test_transfer_to_org_that_was_not_dispatch_target_is_invalid_transition():
    def mutate(c):
        c["transfers"][0]["toOrg"] = "unknown-org"

    [det] = detect_invalid_transition(_ctx(mutate), NOW)
    assert det.indicator.code == "INVALID_TRANSITION"
    assert det.evidence[0].ref == "tr-1"


def test_matching_or_unspecified_dispatch_target_is_valid():
    assert detect_invalid_transition(_ctx(_noop), NOW) == []

    def mutate(c):
        c["transfers"][0]["expectedToOrg"] = None
        c["transfers"][0]["toOrg"] = "anyone"

    assert detect_invalid_transition(_ctx(mutate), NOW) == []


def test_sold_6000_of_5000_is_quantity_inconsistency():
    def mutate(c):
        c["batch"]["totalSold"] = 6000

    [det] = detect_quantity(_ctx(mutate), NOW)
    assert det.indicator.code == "QUANTITY_INCONSISTENCY"
    assert det.indicator.normalizedSignal == 1.0
    assert det.indicator.family == "inventory"


def test_mild_excess_scores_lower_and_holdings_overage_is_flagged():
    def mutate(c):
        c["batch"]["totalTransferred"] = 5100

    [det] = detect_quantity(_ctx(mutate), NOW)
    assert 0.6 < det.indicator.normalizedSignal < 1.0

    def mutate_holdings(c):
        c["batch"]["holdings"] = [{"orgId": "a", "quantity": 4000}, {"orgId": "b", "quantity": 2000}]

    assert detect_quantity(_ctx(mutate_holdings), NOW)


def test_quantity_within_limits_not_flagged():
    assert detect_quantity(_ctx(_noop), NOW) == []


def test_expired_batch_transfer_flagged():
    def mutate(c):
        c["batch"]["expiryDate"] = (NOW - timedelta(days=5)).isoformat()
        c["transfers"][0]["createdAt"] = (NOW - timedelta(days=1)).isoformat()

    [det] = detect_expired_movement(_ctx(mutate), NOW)
    assert det.indicator.code == "EXPIRED_BATCH_MOVEMENT"


def test_expired_batch_sale_event_flagged_and_cancelled_transfer_ignored():
    def mutate(c):
        c["batch"]["expiryDate"] = (NOW - timedelta(days=5)).isoformat()
        c["transfers"][0]["createdAt"] = (NOW - timedelta(days=1)).isoformat()
        c["transfers"][0]["status"] = "CANCELLED"
        c["events"] = [{"type": "RETAIL_SALE", "actorOrg": "ret", "occurredAt": (NOW - timedelta(hours=1)).isoformat()}]

    [det] = detect_expired_movement(_ctx(mutate), NOW)
    assert [e.kind for e in det.evidence] == ["event"]


def test_expired_batch_without_movement_or_valid_batch_not_flagged():
    def expired_idle(c):
        c["batch"]["expiryDate"] = (NOW - timedelta(days=5)).isoformat()

    assert detect_expired_movement(_ctx(expired_idle), NOW) == []
    assert detect_expired_movement(_ctx(_noop), NOW) == []

    def no_expiry(c):
        c["batch"]["expiryDate"] = None

    assert detect_expired_movement(_ctx(no_expiry), NOW) == []


def test_blocked_attempts_scale_with_count():
    def mutate(c):
        c["blockedAttempts"] = [{"kind": "UNAUTHORIZED_TRANSFER", "at": NOW.isoformat(), "actorOrg": "x"}] * 3

    [det] = detect_blocked_attempts(_ctx(mutate), NOW)
    assert det.indicator.normalizedSignal == 0.6
    assert detect_blocked_attempts(_ctx(_noop), NOW) == []


def test_revoked_qr_scanned_flagged_only_when_scanned():
    def revoked(c):
        c["batch"]["qrStatus"] = "revoked"

    [det] = detect_revoked_scanned(_ctx(revoked), NOW)
    assert det.indicator.code == "REVOKED_QR_SCANNED"

    def revoked_no_scan(c):
        c["batch"]["qrStatus"] = "REVOKED"
        c["scans"] = []

    assert detect_revoked_scanned(_ctx(revoked_no_scan), NOW) == []
    assert detect_revoked_scanned(_ctx(_noop), NOW) == []


def test_chain_failure_only_when_explicitly_false():
    def failed(c):
        c["chainVerified"] = False

    [det] = detect_chain_failure(_ctx(failed), NOW)
    assert det.indicator.code == "CHAIN_VERIFICATION_FAILED"

    def unknown(c):
        c["chainVerified"] = None

    assert detect_chain_failure(_ctx(unknown), NOW) == []
    assert detect_chain_failure(_ctx(_noop), NOW) == []


def test_actor_history_capped_and_only_for_involved_orgs():
    def mutate(c):
        c["actorHistory"] = {
            "mfr": {"priorAlerts": 20, "priorRiskAvg": 90},
            "stranger": {"priorAlerts": 50, "priorRiskAvg": 99},
        }

    [det] = detect_actor_history(_ctx(mutate), NOW)
    assert det.indicator.normalizedSignal == 0.8
    assert det.evidence[0].ref == "mfr"


def test_actor_history_clean_or_missing_not_flagged():
    def clean(c):
        c["actorHistory"] = {"mfr": {"priorAlerts": 0, "priorRiskAvg": 0}}

    assert detect_actor_history(_ctx(clean), NOW) == []

    def none(c):
        c["actorHistory"] = {}

    assert detect_actor_history(_ctx(none), NOW) == []
