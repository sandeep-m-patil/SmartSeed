"""Train a baseline IsolationForest on SYNTHETIC data (or your own rows file).

The manifest records the data as SYNTHETIC. No accuracy metric is computed for the
unsupervised model. Pass --supervised to also train XGBoost (requires xgboost and
labels; metrics are a genuine holdout on SYNTHETIC data and NOT real performance).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api_models import TrainRequest  # noqa: E402
from app.constants import DEFAULT_MODELS_DIR, DEFAULT_SUPERVISED_MODEL, DEFAULT_UNSUPERVISED_MODEL, FEATURE_NAMES  # noqa: E402
from app.model_service import train_model  # noqa: E402
from app.registry import ModelRegistry  # noqa: E402
from app.synthetic import generate_rows  # noqa: E402

SYNTHETIC_DESCRIPTION = "SYNTHETIC generated feature rows (app/synthetic.py); not real scan data."
DEFAULT_BENIGN = 400
DEFAULT_ANOMALOUS = 100
DEFAULT_SEED = 7


def _features_only(rows: list[dict]) -> list[dict[str, float]]:
    return [{k: float(r[k]) for k in FEATURE_NAMES} for r in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", type=Path, default=Path(DEFAULT_MODELS_DIR))
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--supervised", action="store_true")
    args = parser.parse_args()
    rows = generate_rows(DEFAULT_BENIGN, DEFAULT_ANOMALOUS, args.seed)
    registry = ModelRegistry(args.models_dir)
    feats = _features_only(rows)
    unsup = TrainRequest(rows=feats, dataDescription=SYNTHETIC_DESCRIPTION, synthetic=True)
    print(json.dumps(train_model(registry, DEFAULT_UNSUPERVISED_MODEL, unsup), indent=2))
    if args.supervised:
        labels = [int(r["label"]) for r in rows]
        sup = TrainRequest(rows=feats, labels=labels, dataDescription=SYNTHETIC_DESCRIPTION, synthetic=True)
        print(json.dumps(train_model(registry, DEFAULT_SUPERVISED_MODEL, sup), indent=2))


if __name__ == "__main__":
    main()
