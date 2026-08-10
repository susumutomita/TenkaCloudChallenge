"""Public examples.  They intentionally pass the shipped delete-only starter."""

from __future__ import annotations

import argparse
import importlib
import os
import sys
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter"))
sys.path.insert(0, str(SUBMISSION))
cache_policy = importlib.import_module("cache_policy")


def state(entries: dict[str, dict[str, int]] | None = None) -> dict[str, dict]:
    return {"entries": {k: dict(v) for k, v in (entries or {}).items()}, "floors": {}}


def stable_miss_is_filled() -> None:
    cache = state()
    assert cache_policy.admit_fill(cache, "sku-101", 450, 7) is True
    assert cache["entries"] == {"sku-101": {"value": 450, "revision": 7}}


def sequential_update_replaces_the_entry() -> None:
    cache = state({"sku-101": {"value": 450, "revision": 7}})
    cache_policy.invalidate(cache, "sku-101", 8)
    assert "sku-101" not in cache["entries"]
    assert cache_policy.admit_fill(cache, "sku-101", 475, 8) is True
    assert cache["entries"]["sku-101"] == {"value": 475, "revision": 8}


def another_key_survives_a_sequential_update() -> None:
    cache = state(
        {
            "sku-101": {"value": 450, "revision": 7},
            "sku-202": {"value": 900, "revision": 3},
        }
    )
    cache_policy.invalidate(cache, "sku-101", 8)
    assert cache["entries"]["sku-202"] == {"value": 900, "revision": 3}


TESTS: dict[str, Callable[[], None]] = {
    "stable miss is filled": stable_miss_is_filled,
    "sequential update replaces the entry": sequential_update_replaces_the_entry,
    "another key survives a sequential update": another_key_survives_a_sequential_update,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only")
    args = parser.parse_args()
    selected = {
        name: test for name, test in TESTS.items() if args.only is None or args.only in name
    }
    if not selected:
        print("no public test matched")
        return 2
    failures: list[str] = []
    for name, test in selected.items():
        try:
            test()
            print(f"PASS {name}")
        except Exception as error:  # noqa: BLE001 - public runner reports the example
            failures.append(f"FAIL {name}: {type(error).__name__}")
    if failures:
        print("\n".join(failures))
        return 1
    print(f"all passed ({len(selected)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
