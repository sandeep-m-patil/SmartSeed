from datetime import timedelta

import numpy as np

from app.constants import FEATURE_NAMES
from app.features import build_features, max_window_count
from app.geo import haversine_km
from app.stats import detect_interval_outliers, detect_volume_outlier, mad, modified_z_scores

from .conftest import DELHI, HYD, NOW, benign_payload, ctx_of, scan


def _ctx(scans):
    data = benign_payload()
    data["context"]["scans"] = scans
    return ctx_of(data)


def test_mad_and_modified_z_basic():
    values = np.array([10.0, 11.0, 9.0, 10.0, 100.0])
    assert mad(values) == 1.0
    assert modified_z_scores(values)[-1] > 3.5


def test_modified_z_with_zero_mad_uses_fallback_or_zeros():
    flat = np.array([5.0, 5.0, 5.0])
    assert modified_z_scores(flat).tolist() == [0.0, 0.0, 0.0]
    assert modified_z_scores(np.array([0.0, 0.0, 0.0, 10.0]), min_scale=1.0)[-1] > 0


def test_interval_outliers_detect_rapid_scans_after_slow_history():
    slow = [scan(NOW - timedelta(hours=40 + 5 * i + (i % 3)), device=f"s{i}") for i in range(14)]
    fast = [scan(NOW - timedelta(seconds=i), device=f"f{i}") for i in range(8)]
    [det] = detect_interval_outliers(_ctx(slow + fast), NOW)
    assert det.indicator.code == "SCAN_INTERVAL_OUTLIER"


def test_interval_outliers_quiet_for_benign_and_for_sparse_data():
    assert detect_interval_outliers(_ctx([scan(NOW)]), NOW) == []
    rng = np.random.default_rng(0)
    gaps = np.cumsum(rng.exponential(3600, 60))
    scans = [scan(NOW - timedelta(seconds=float(g)), device=f"d{i}") for i, g in enumerate(gaps)]
    assert detect_interval_outliers(_ctx(scans), NOW) == []


def test_volume_outlier_flags_spike_versus_history():
    history = [scan(NOW - timedelta(days=d, hours=1), device=f"h{d}") for d in range(1, 10)]
    today = [scan(NOW - timedelta(minutes=i), device=f"t{i}") for i in range(80)]
    [det] = detect_volume_outlier(_ctx(history + today), NOW)
    assert det.indicator.code == "SCAN_VOLUME_OUTLIER"
    assert det.indicator.normalizedSignal > 0.5


def test_volume_outlier_needs_history_and_volume():
    assert detect_volume_outlier(_ctx([]), NOW) == []
    today = [scan(NOW - timedelta(minutes=i), device=f"t{i}") for i in range(80)]
    assert detect_volume_outlier(_ctx(today), NOW) == []
    history = [scan(NOW - timedelta(days=d, hours=1), device=f"h{d}") for d in range(1, 10)]
    assert detect_volume_outlier(_ctx(history), NOW) == []


def test_volume_steady_series_is_not_outlier():
    one_day = [scan(NOW - timedelta(days=d, minutes=m), device=f"x{d}-{m}") for d in range(0, 10) for m in range(25)]
    assert detect_volume_outlier(_ctx(one_day), NOW) == []


def test_haversine_known_distance():
    assert 1230 < haversine_km(*HYD, *DELHI) < 1280


def test_max_window_count():
    assert max_window_count([0, 1, 2, 1000], 10) == 3
    assert max_window_count([], 10) == 0


def test_features_have_all_names_and_expected_values():
    scans = [scan(NOW - timedelta(minutes=2), HYD, "a"), scan(NOW, DELHI, "b")]
    feats = build_features(_ctx(scans), NOW)
    assert tuple(feats) == FEATURE_NAMES
    assert feats["scan_count"] == 2
    assert feats["distinct_devices"] == 2
    assert feats["distinct_locations"] == 2
    assert feats["max_speed_kmh"] > 10000
    assert abs(feats["days_to_expiry"] - 300) < 1e-6
    assert feats["quantity_ratio"] == 0.6


def test_features_handle_empty_context_and_missing_expiry():
    data = benign_payload()
    data["context"].update(scans=[], transfers=[])
    data["context"]["batch"].update(expiryDate=None, initialQuantity=0)
    feats = build_features(ctx_of(data), NOW)
    assert feats["scan_count"] == 0
    assert feats["quantity_ratio"] == 0.0
    assert feats["days_to_expiry"] > 1000
