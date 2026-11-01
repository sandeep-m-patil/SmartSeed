from datetime import timedelta

from app.detectors_scan import detect_burst, detect_dormant_spike, detect_impossible_travel, detect_repeat_device

from .conftest import DELHI, HYD, NOW, benign_payload, ctx_of, scan


def _ctx(scans, events=None):
    data = benign_payload()
    data["context"]["scans"] = scans
    if events is not None:
        data["context"]["events"] = events
    return ctx_of(data)


def test_burst_100_scans_in_10_minutes_is_flagged_at_full_signal():
    scans = [scan(NOW - timedelta(seconds=i * 5), device=f"d{i}") for i in range(100)]
    [det] = detect_burst(_ctx(scans), NOW)
    assert det.indicator.code == "SCAN_BURST"
    assert det.indicator.normalizedSignal == 1.0
    assert det.indicator.family == "scan_behaviour"


def test_burst_below_minimum_is_ignored():
    scans = [scan(NOW - timedelta(seconds=i * 5), device=f"d{i}") for i in range(19)]
    assert detect_burst(_ctx(scans), NOW) == []


def test_burst_requires_density_not_just_volume():
    scans = [scan(NOW - timedelta(minutes=30 * i), device=f"d{i}") for i in range(100)]
    assert detect_burst(_ctx(scans), NOW) == []


def test_impossible_travel_hyderabad_to_delhi_in_two_minutes():
    scans = [scan(NOW - timedelta(minutes=2), HYD, "a"), scan(NOW, DELHI, "b")]
    [det] = detect_impossible_travel(_ctx(scans), NOW)
    assert det.indicator.code == "IMPOSSIBLE_TRAVEL"
    assert det.indicator.normalizedSignal == 1.0
    assert "km" in det.evidence[0].detail


def test_plausible_flight_speed_is_not_flagged():
    scans = [scan(NOW - timedelta(hours=3), HYD, "a"), scan(NOW, DELHI, "b")]  # ~1,255 km / 3h = 420 km/h
    assert detect_impossible_travel(_ctx(scans), NOW) == []


def test_short_hop_with_gps_jitter_is_not_flagged():
    scans = [scan(NOW - timedelta(seconds=1), HYD, "a"), scan(NOW, (HYD[0] + 0.01, HYD[1]), "b")]
    assert detect_impossible_travel(_ctx(scans), NOW) == []


def test_scans_without_coordinates_are_skipped():
    s = scan(NOW)
    s["lat"] = None
    assert detect_impossible_travel(_ctx([s, scan(NOW - timedelta(minutes=1), DELHI)]), NOW) == []


def test_dormant_qr_with_sudden_volume_is_flagged():
    old = scan(NOW - timedelta(days=90), device="old")
    recent = [scan(NOW - timedelta(minutes=i), device=f"n{i}") for i in range(60)]
    [det] = detect_dormant_spike(_ctx([old, *recent], []), NOW)
    assert det.indicator.code == "DORMANT_QR_SPIKE"
    assert det.indicator.normalizedSignal > 0.5


def test_active_qr_with_volume_is_not_dormant():
    earlier = scan(NOW - timedelta(days=3), device="old")
    recent = [scan(NOW - timedelta(minutes=i), device=f"n{i}") for i in range(60)]
    assert detect_dormant_spike(_ctx([earlier, *recent]), NOW) == []


def test_dormancy_counts_events_as_activity():
    events = [{"type": "CREATED", "actorOrg": "mfr", "occurredAt": (NOW - timedelta(days=3)).isoformat()}]
    recent = [scan(NOW - timedelta(minutes=i), device=f"n{i}") for i in range(60)]
    assert detect_dormant_spike(_ctx(recent, events), NOW) == []


def test_dormant_without_history_or_volume_is_ignored():
    assert detect_dormant_spike(_ctx([scan(NOW)]), NOW) == []
    recent = [scan(NOW - timedelta(minutes=i), device=f"n{i}") for i in range(60)]
    assert detect_dormant_spike(_ctx(recent, []), NOW) == []


def test_repeat_device_scans_flagged():
    scans = [scan(NOW - timedelta(hours=i), device="same") for i in range(25)]
    [det] = detect_repeat_device(_ctx(scans), NOW)
    assert det.indicator.code == "REPEAT_DEVICE_SCANS"
    assert det.indicator.normalizedSignal == 0.5


def test_repeat_device_below_minimum_or_absent():
    scans = [scan(NOW - timedelta(hours=i), device="same") for i in range(5)]
    assert detect_repeat_device(_ctx(scans), NOW) == []
    assert detect_repeat_device(_ctx([]), NOW) == []
