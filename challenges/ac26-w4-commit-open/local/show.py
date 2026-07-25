"""`make inspect` — the vector, the tree, and the query."""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    DOMAIN,
    build_tree,
    health_token,
    opening_for,
    root_of,
    setting,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    cfg = setting(SEED)
    values, index = cfg["values"], cfg["query"]
    levels = build_tree(values)

    print("health token :", health_token(SEED))
    print(f"vector length: {cfg['length']}   (a power of two, so no level is ragged)")
    print(f"domain       : {DOMAIN}")
    print(f"the verifier will ask about index {index}")
    print()
    print("  i     value    leaf hash")
    for position, value in enumerate(values):
        marker = " <- asked" if position == index else ""
        print(f"  {position:<5} {value:<8} {levels[0][position].hex()[:16]}...{marker}")
    print()
    print(f"root         : {root_of(values).hex()}")
    print(f"tree levels  : {len(levels)}   path length: {len(levels) - 1}")
    print()
    print("the authentication path for that index:")
    for step, entry in enumerate(opening_for(values, index)):
        side = "left" if entry["sibling_is_left"] else "right"
        print(f"  step {step}: sibling on the {side:<5} {entry['hash'].hex()[:16]}...")
    print()
    print("Three steps, in order: commit, then challenge, then open.")
    print("Work out what changes if the prover learns the query first.")


if __name__ == "__main__":
    main()
