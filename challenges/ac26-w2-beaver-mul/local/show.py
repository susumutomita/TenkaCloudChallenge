"""`make inspect` — your setting, your triple's shares, and the protocol on one page."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import health_token, setting, shares_of, triple_shares

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    cfg = setting(SEED)
    p, n = cfg["p"], cfg["n"]
    triple = triple_shares(SEED, "public")
    print(f"== your setting ==\n  modulus p = {p}\n  parties  n = {n}")
    print("  (x, y, a, b and c are all shared -- nobody holds any of them in the clear)")
    print()
    print("== the preprocessed triple, as each party holds it ==")
    for name in ("a", "b", "c"):
        print(f"  shares of {name}: {json.dumps(triple[name])}")
    print("  The triple satisfies c = a*b. It was generated before anyone knew x or y.")
    print()
    print("== shares of x, one row per party ==")
    print(f"  {json.dumps(shares_of(SEED, 'public-x', cfg['x'], n, p))}")
    print()
    print("== the protocol ==")
    print("  d = x - a          each party, locally")
    print("  e = y - b          each party, locally")
    print("  open d, open e     one round")
    print("  x*y = c + d*b + e*a + d*e")
    print()
    print("  Before you write combine: three of those four terms are like each other.")
    print("  One is not. Which one, and what does that change?")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
