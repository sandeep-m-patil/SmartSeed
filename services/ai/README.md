# SmartSeed AI service

FastAPI service that turns a batch/QR/transfer context into a 0-100 risk score with
indicators, evidence and a recommended action. Hybrid detection: deterministic rules +
robust statistics (modified z-score / MAD) + IsolationForest (when a model is trained) +
XGBoost (only when labelled data is supplied).

A score is a prioritisation signal. The service never states that a product is
counterfeit; Critical results only recommend *proposing* a temporary hold through the
authorised approval workflow.

## Run

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
# optional, enables supervised training: .venv\Scripts\python -m pip install -r requirements-optional.txt
$env:AI_SHARED_SECRET = "<long random secret>"      # required; there is no default
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Docker: `docker build -t smartseed-ai .` then
`docker run -e AI_SHARED_SECRET=... -p 8000:8000 -v ai-models:/app/models smartseed-ai`
(non-root user, `/healthz` healthcheck).

## Test

```powershell
.venv\Scripts\python -m pytest --cov=app --cov-report=term-missing
.venv\Scripts\python -m mypy app
```

## Configuration (environment)

| Variable | Meaning |
|---|---|
| `AI_SHARED_SECRET` | HMAC key shared with the API service. Required; `/v1` fails closed (401) without it. |
| `AI_MODELS_DIR` | Model registry root (default `models`). Artifacts are joblib pickles: only point at trusted storage. |
| `AI_UNSUPERVISED_MODEL` / `AI_SUPERVISED_MODEL` | Registry names used at scoring time (defaults `isolation_forest`, `xgboost_supervised`). Latest version is used. |
| `AI_SIGN_TIMESTAMP` | `true` => signature covers `"<X-Timestamp>.<body>"` (binds the timestamp, stops replay inside the 5 min window being re-dated). Default: signature = HMAC of raw body only, per the API contract. |
| `AI_LOG_LEVEL` | Log level (JSON logs to stdout). |

## Authentication

Every `/v1` call (including GET) needs `X-Signature` = hex HMAC-SHA256(`AI_SHARED_SECRET`, raw body)
(empty body for GET) and `X-Timestamp` (epoch seconds or ISO-8601) within 5 minutes of server time.
Anything else returns 401. `/healthz` is unauthenticated.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | liveness |
| POST | `/v1/score` | score a subject (schema in `app/schemas.py`) |
| GET | `/v1/models` | registered models, versions, manifests |
| POST | `/v1/models/{name}/train` | train from supplied feature rows: no labels => IsolationForest; labels => XGBoost (400 with a clear message if xgboost missing or labels insufficient: >= 100 labelled rows, >= 20 per class) |
| POST | `/v1/models/{name}/evaluate` | evaluate on supplied rows; metrics only when labels are supplied |
| POST | `/v1/drift` | per-feature PSI between `reference` and `current` rows (<0.1 stable, <0.25 moderate, else significant) |

Training/evaluate rows use the 11 features in `app/constants.py::FEATURE_NAMES`
(`scan_count`, `scan_rate_per_hour`, `inter_scan_mean_s`, `inter_scan_std_s`, `distinct_devices`,
`distinct_locations`, `max_speed_kmh`, `transfer_frequency`, `quantity_ratio`, `days_to_expiry`,
`max_scans_10min`). Request fields `dataDescription` and `synthetic` are recorded in the manifest
and echoed back.

## Risk engine (`app/risk_engine.py`)

Signals are normalised to [0,1], grouped into families (scan_behaviour, geo, chain_integrity,
inventory, expiry, actor_history, ml). Family score = max within the family (no double counting);
`final = 100 * sum(w_f * s_f) / sum(w_f)`. Default weights and thresholds live in `DEFAULT_CONFIG`
(`configVersion`), overridable per request via `config.weights` / `config.thresholds` (validated;
overrides append `+custom` to `configVersion`). Levels: 0-24 LOW, 25-49 MEDIUM, 50-74 HIGH, 75-100 CRITICAL.

Floors (not overridable): chain verification failed or revoked QR scanned => >= 75; expired batch
moved => >= 50; any family score >= 0.8 => >= 50 (so a single decisive signal is not diluted by the
weighted average; this last floor is a design choice added on top of the architecture doc).

Rule detectors (`detectors_scan.py`, `detectors_chain.py`, `stats.py`): burst scans, impossible
travel (haversine), invalid transition, quantity inconsistency, dormant QR spike, expired movement,
repeat device, blocked attempts, revoked QR, failed chain verification, actor history, plus
robust-z interval/volume outliers. Thresholds are named constants in `app/constants.py`; they are
engineering defaults, not tuned on real data.

## Models, honesty about performance

* Artifacts: `models/<name>/<version>/{model.joblib,manifest.json}` (versions `v1`, `v2`, ...).
* The manifest has `metrics` only if genuinely computed (supervised holdout). IsolationForest manifests
  have `metrics: null`. The `calibration` block is the training-score quantiles used to scale the
  anomaly signal; it is not an accuracy figure.
* With no trained model the service runs rules + statistics and says so in `notes`
  (`mode: "rules+unsupervised"`). `hybrid-supervised` is reported only when a supervised model is loaded.
* `confidence` is a heuristic (data sufficiency + corroboration across families), not a calibrated probability.

### SYNTHETIC data

`scripts/make_synthetic_data.py` and `scripts/train_baseline.py` use `app/synthetic.py`, which
generates **SYNTHETIC** rows. Models trained on them are labelled `synthetic: true` with a warning in
the manifest, `/v1/models`, train/evaluate responses and scoring `notes`. Anything computed on them
(including holdout metrics) describes generated data only and must not be presented as real-world
performance.

```powershell
.venv\Scripts\python scripts\make_synthetic_data.py --out data\synthetic_features.json
.venv\Scripts\python scripts\train_baseline.py            # IsolationForest, SYNTHETIC
.venv\Scripts\python scripts\train_baseline.py --supervised   # also XGBoost (needs xgboost)
```

## Limitations

* Rules use fixed thresholds that need tuning on real traffic; ML signal quality is unknown until real data exists.
* Detectors see only the context sent in the request (e.g. dormancy relies on provided scans/events).
* The default signature covers the body only; enable `AI_SIGN_TIMESTAMP` (and update the caller) to bind the timestamp. Replays inside the window are not deduplicated.
* Model loading uses joblib (pickle): keep the models directory trusted.
