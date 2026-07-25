"""Public tests. They show the shape of an answer; they do not prove one correct.

They commit, ask, open, and verify. Once. They never present a leaf from the wrong index,
never flip a sibling's side, never take the steps out of order, and never ask what the
commitment would be worth if the query came first.

An implementation whose leaves do not bind their index passes this file completely.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import commit as submission  # noqa: E402
from fixtures.generate import root_of, setting  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_root_matches() -> str:
    cfg = setting(SEED)
    if submission.merkle_root(list(cfg["values"])) != root_of(cfg["values"]):
        return "the root does not match the committed vector"
    return ""


def check_an_honest_opening_verifies() -> str:
    cfg = setting(SEED)
    values, index = list(cfg["values"]), cfg["query"]
    root = submission.merkle_root(values)
    path = submission.open_at(values, index)
    if not submission.verify_opening(root, index, values[index], path, cfg["length"]):
        return "an honest opening did not verify"
    return ""


CHECKS = (
    ("root-matches", check_root_matches),
    ("an-honest-opening-verifies", check_an_honest_opening_verifies),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here tried to cheat, and cheating is what the checkpoints test.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
