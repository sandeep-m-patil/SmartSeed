"""Generate SYNTHETIC feature rows (JSON). Not real data; see README."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.synthetic import SYNTHETIC_LABEL, generate_rows  # noqa: E402

DEFAULT_BENIGN = 400
DEFAULT_ANOMALOUS = 100
DEFAULT_SEED = 7


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benign", type=int, default=DEFAULT_BENIGN)
    parser.add_argument("--anomalous", type=int, default=DEFAULT_ANOMALOUS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", type=Path, default=Path("data/synthetic_features.json"))
    args = parser.parse_args()
    rows = generate_rows(args.benign, args.anomalous, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"origin": SYNTHETIC_LABEL, "seed": args.seed, "rows": rows}
    args.out.write_text(json.dumps(payload), encoding="utf-8")
    print(f"[{SYNTHETIC_LABEL}] wrote {len(rows)} rows to {args.out}")


if __name__ == "__main__":
    main()
