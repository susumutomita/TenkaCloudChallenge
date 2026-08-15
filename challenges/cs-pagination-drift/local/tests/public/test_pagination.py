"""Intentionally incomplete public tests: the shipped starter passes all of them.

Every test here pages over a table that holds still. That is the blind spot: an
offset over a still table is indistinguishable from a cursor, and it only stops
being one when writes land between the page calls.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "pagination.py"

from fixtures.generate import MemoryStore  # noqa: E402 - path set above


def _load():
    spec = importlib.util.spec_from_file_location("participant_pagination", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load pagination.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "new_paginator"):
        raise AssertionError("pagination.py must define new_paginator()")
    return module


def _table(count: int, base: int = 41) -> MemoryStore:
    return MemoryStore([{"id": base + index, "value": f"row-{base + index}"} for index in range(count)])


def test_the_documented_listing_works() -> None:
    module = _load()
    paginator = module.new_paginator(_table(7))
    first = paginator.page(3)
    assert first["ok"] is True
    assert [row["id"] for row in first["items"]] == [47, 46, 45]
    second = paginator.page(3, first["cursor"])
    assert [row["id"] for row in second["items"]] == [44, 43, 42]
    third = paginator.page(3, second["cursor"])
    assert [row["id"] for row in third["items"]] == [41]
    assert third["cursor"] is None


def test_every_row_is_served_exactly_once() -> None:
    module = _load()
    paginator = module.new_paginator(_table(10))
    served: list[int] = []
    cursor = None
    for _ in range(10):
        reply = paginator.page(4, cursor)
        served.extend(row["id"] for row in reply["items"])
        cursor = reply["cursor"]
        if cursor is None:
            break
    assert served == sorted(served, reverse=True)
    assert sorted(served) == [41 + index for index in range(10)]


def test_a_page_never_exceeds_its_size() -> None:
    module = _load()
    paginator = module.new_paginator(_table(5))
    reply = paginator.page(2)
    assert len(reply["items"]) == 2


def test_an_empty_table_is_one_empty_final_page() -> None:
    module = _load()
    reply = module.new_paginator(MemoryStore()).page(3)
    assert reply == {"ok": True, "items": [], "cursor": None}


def test_a_size_beyond_the_table_serves_everything() -> None:
    module = _load()
    reply = module.new_paginator(_table(4)).page(9)
    assert [row["id"] for row in reply["items"]] == [44, 43, 42, 41]
    assert reply["cursor"] is None


def test_a_bad_size_is_refused() -> None:
    module = _load()
    paginator = module.new_paginator(_table(4))
    for size in (0, -1, 101, "3"):
        assert paginator.page(size) == {"ok": False, "error": "invalid_size"}


def test_each_paginator_iterates_on_its_own() -> None:
    module = _load()
    store = _table(6)
    first = module.new_paginator(store)
    second = module.new_paginator(store)
    assert [row["id"] for row in first.page(2)["items"]] == [46, 45]
    assert [row["id"] for row in second.page(3)["items"]] == [46, 45, 44]


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-pagination-drift"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "observe", "audit", "paginate", "stability", "generalize"
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "paginate", "stability", "generalize"}


TESTS = {
    name: value
    for name, value in globals().items()
    if name.startswith("test_") and callable(value)
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    selected = {name: test for name, test in TESTS.items() if args.only in name}
    if not selected:
        print("no public test matched", file=sys.stderr)
        return 2
    failures: list[str] = []
    for name, test in selected.items():
        try:
            test()
            print(f"pass {name}")
        except Exception as error:  # noqa: BLE001 - test runner reports each failure
            failures.append(name)
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    print(f"all passed ({len(selected)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
