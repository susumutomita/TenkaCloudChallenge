"""`make inspect` — your setting, your shares, and the four operations to classify."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import OPERATIONS, health_token, setting, shares_of

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    cfg = setting(SEED)
    p, n, c = cfg["p"], cfg["n"], cfg["c"]
    print(f"== your setting ==\n  modulus p = {p}\n  parties  n = {n}\n  public constant c = {c}")
    print("  (x and y are not printed -- they are the shared secrets)")
    print()
    print("== shares of x, one row per party ==")
    for index, value in enumerate(shares_of(SEED, "public-x", cfg["x"], n, p)):
        print(f"  party {index}: {value}")
    print()
    print("== the four operations ==")
    for operation in OPERATIONS:
        print(f"  {operation}")
    print("  For each: can every party act alone on its own share, or must they talk?")
    print("  Write your answer down before you run anything.")
    print()
    print("== the one to slow down on ==")
    print(f"  If all {n} parties each add c to their own share, what does the set sum to?")
    print(f"  Work it out on paper: it is not x + {c}.")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
