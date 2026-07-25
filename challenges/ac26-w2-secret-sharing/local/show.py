"""`make inspect` — your setting, and what a partial view actually looks like."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import health_token, randomness, reference_shares, setting

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    cfg = setting(SEED)
    p, n = cfg["p"], cfg["n"]
    print(f"== your setting ==\n  modulus p = {p}\n  parties  n = {n}")
    print("  (the secret is not printed -- that is rather the point)")
    print()
    shares = reference_shares(SEED)
    print("== what party 0 through n-2 can see between them ==")
    print(f"  {json.dumps(shares[:-1])}")
    print("  Ask yourself, before running anything: which secrets are consistent with")
    print("  those values? Write your answer down, then make complete_shares prove it.")
    print()
    print("== randomness you are given ==")
    print(f"  {json.dumps(randomness(SEED, 'public', n - 1, p))}")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
