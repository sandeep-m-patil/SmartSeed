"""Named constants. No magic numbers elsewhere in the service."""
from typing import Final

SERVICE_NAME: Final = "smartseed-ai"
RULES_VERSION: Final = "rules-1.0.0"

# ---- auth ----
SIGNATURE_HEADER: Final = "X-Signature"
TIMESTAMP_HEADER: Final = "X-Timestamp"
TIMESTAMP_TOLERANCE_SECONDS: Final = 300

# ---- environment variable names ----
ENV_SHARED_SECRET: Final = "AI_SHARED_SECRET"
ENV_MODELS_DIR: Final = "AI_MODELS_DIR"
ENV_LOG_LEVEL: Final = "AI_LOG_LEVEL"
ENV_BIND_TIMESTAMP: Final = "AI_SIGN_TIMESTAMP"
ENV_UNSUPERVISED_MODEL: Final = "AI_UNSUPERVISED_MODEL"
ENV_SUPERVISED_MODEL: Final = "AI_SUPERVISED_MODEL"
DEFAULT_MODELS_DIR: Final = "models"
DEFAULT_UNSUPERVISED_MODEL: Final = "isolation_forest"
DEFAULT_SUPERVISED_MODEL: Final = "xgboost_supervised"

# ---- time ----
SECONDS_PER_HOUR: Final = 3600.0
SECONDS_PER_DAY: Final = 86400.0
MIN_ELAPSED_SECONDS: Final = 1.0

# ---- scan behaviour rules ----
BURST_WINDOW_SECONDS: Final = 600.0
BURST_MIN_COUNT: Final = 20
BURST_FULL_COUNT: Final = 100
REPEAT_DEVICE_MIN_SCANS: Final = 10
REPEAT_DEVICE_FULL_SCANS: Final = 50
RECENT_WINDOW_HOURS: Final = 24.0
DORMANT_DAYS: Final = 30.0
DORMANT_MIN_RECENT_SCANS: Final = 20
DORMANT_FULL_SCANS: Final = 100
DORMANT_BASE_SIGNAL: Final = 0.5

# ---- geo rules ----
EARTH_RADIUS_KM: Final = 6371.0088
MAX_PLAUSIBLE_SPEED_KMH: Final = 900.0
MIN_TRAVEL_KM: Final = 50.0
IMPOSSIBLE_BASE_SIGNAL: Final = 0.7
IMPOSSIBLE_SPEED_SPAN_KMH: Final = 9000.0
MAX_SPEED_FEATURE_KMH: Final = 20000.0
LOCATION_ROUND_DIGITS: Final = 1
NO_EXPIRY_DAYS: Final = 3650.0

# ---- inventory / chain / expiry rules ----
INVALID_TRANSITION_SIGNAL: Final = 0.9
QUANTITY_BASE_SIGNAL: Final = 0.6
QUANTITY_EXCESS_GAIN: Final = 2.0
EXPIRED_MOVEMENT_SIGNAL: Final = 0.8
BLOCKED_FULL_COUNT: Final = 5
PRIOR_ALERTS_FULL: Final = 10
ACTOR_HISTORY_MAX_SIGNAL: Final = 0.8
ACTOR_MIN_SIGNAL: Final = 0.1
INACTIVE_TRANSFER_STATUSES: Final = frozenset({"CANCELLED", "REJECTED"})
MOVEMENT_EVENT_KEYWORDS: Final = ("transfer", "dispatch", "sale", "sold", "receive", "receipt")

# ---- statistics ----
MAD_NORMAL_CONSISTENCY: Final = 0.6745
MODIFIED_Z_THRESHOLD: Final = 3.5
MIN_INTERVALS_FOR_STATS: Final = 10
MIN_SHORT_INTERVAL_OUTLIERS: Final = 5
INTERVAL_OUTLIER_FULL_FRACTION: Final = 0.5
INTERVAL_MIN_FRACTION: Final = 0.1
VOLUME_HISTORY_DAYS: Final = 14
VOLUME_MIN_HISTORY_DAYS: Final = 4
VOLUME_MIN_CURRENT: Final = 20
VOLUME_MIN_SCALE: Final = 1.0
VOLUME_Z_FULL_EXTRA: Final = 10.0
VOLUME_BASE_SIGNAL: Final = 0.5

# ---- risk engine ----
LEVEL_LOW: Final = "LOW"
LEVEL_MEDIUM: Final = "MEDIUM"
LEVEL_HIGH: Final = "HIGH"
LEVEL_CRITICAL: Final = "CRITICAL"
MAX_SCORE: Final = 100
DEFAULT_THRESHOLD_LOW_MAX: Final = 24
DEFAULT_THRESHOLD_MEDIUM_MAX: Final = 49
DEFAULT_THRESHOLD_HIGH_MAX: Final = 74
CRITICAL_FLOOR: Final = 75
EXPIRED_FLOOR: Final = 50
STRONG_SIGNAL_THRESHOLD: Final = 0.8
STRONG_SIGNAL_FLOOR: Final = 50
CONFIG_VERSION: Final = "2025.1-default"
CUSTOM_CONFIG_SUFFIX: Final = "+custom"

FAMILY_SCAN: Final = "scan_behaviour"
FAMILY_GEO: Final = "geo"
FAMILY_CHAIN: Final = "chain_integrity"
FAMILY_INVENTORY: Final = "inventory"
FAMILY_EXPIRY: Final = "expiry"
FAMILY_ACTOR: Final = "actor_history"
FAMILY_ML: Final = "ml"

# ---- confidence heuristic ----
CONFIDENCE_FULL_SCANS: Final = 10
CONFIDENCE_CORROBORATING_FAMILIES: Final = 3
CONFIDENCE_ACTIVE_FAMILY_SIGNAL: Final = 0.5
CONFIDENCE_DATA_WEIGHT: Final = 0.6
CONFIDENCE_MIN: Final = 0.2

# ---- ML ----
IFOREST_ESTIMATORS: Final = 200
RANDOM_SEED: Final = 42
XGB_ESTIMATORS: Final = 200
XGB_MAX_DEPTH: Final = 4
XGB_LEARNING_RATE: Final = 0.1
MIN_TRAIN_ROWS: Final = 50
MIN_LABELLED_ROWS: Final = 100
MIN_ROWS_PER_CLASS: Final = 20
HOLDOUT_FRACTION: Final = 0.2
MIN_HOLDOUT_ROWS: Final = 20
CALIBRATION_HIGH_QUANTILE: Final = 0.99
CALIBRATION_LOW_QUANTILE: Final = 0.5
CALIBRATION_MIN_SPAN: Final = 1e-9
FLAG_SIGNAL: Final = 0.5
QUANTILE_MEDIAN: Final = 0.5
QUANTILE_P95: Final = 0.95
CLASSIFY_THRESHOLD: Final = 0.5
MODEL_NAME_PATTERN: Final = r"^[a-z0-9][a-z0-9_-]{0,63}$"
MAX_ROWS_PER_REQUEST: Final = 100_000
MAX_SCANS_PER_CONTEXT: Final = 20_000

# ---- drift (PSI) ----
PSI_BINS: Final = 10
PSI_EPSILON: Final = 1e-4
PSI_MODERATE: Final = 0.1
PSI_SIGNIFICANT: Final = 0.25

FEATURE_NAMES: Final = (
    "scan_count",
    "scan_rate_per_hour",
    "inter_scan_mean_s",
    "inter_scan_std_s",
    "distinct_devices",
    "distinct_locations",
    "max_speed_kmh",
    "transfer_frequency",
    "quantity_ratio",
    "days_to_expiry",
    "max_scans_10min",
)

SYNTHETIC_WARNING: Final = (
    "SYNTHETIC data: results describe generated data only and say nothing about "
    "real-world detection performance."
)
DISCLAIMER: Final = (
    "A risk score is a prioritisation signal. It is not a finding that any product "
    "is inauthentic; conclusions require human review of the evidence."
)
