"""Intentionally incomplete public tests: the shipped starter passes all of them.

Every case here uses amounts of a similar size and checks one ordering. That is the
blind spot: a float total is only visibly wrong once the magnitudes are far apart, and
an allocation only visibly fails to add up once the division is not clean.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "aggregate.py"


def _load():
    spec = importlib.util.spec_from_file_location("participant_aggregate", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load aggregate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "summarize"):
        raise AssertionError("aggregate.py must define summarize()")
    return module


def _rows(*amounts: str) -> list[dict[str, str]]:
    return [{"id": f"row-{index}", "amount": amount} for index, amount in enumerate(amounts)]


def test_totals_a_simple_invoice() -> None:
    module = _load()
    result = module.summarize(_rows("10.00", "20.00", "30.50"))
    assert result["ok"] is True
    assert result["total"] == "60.50"


def test_reports_a_share_for_every_row() -> None:
    module = _load()
    result = module.summarize(_rows("25.00", "25.00", "25.00", "25.00"))
    assert set(result["shares"]) == {"row-0", "row-1", "row-2", "row-3"}
    assert result["shares"]["row-0"] == "25.00"


def test_halves_split_evenly() -> None:
    module = _load()
    result = module.summarize(_rows("7.50", "7.50"))
    assert result["total"] == "15.00"
    assert result["shares"] == {"row-0": "50.00", "row-1": "50.00"}


def test_cents_are_preserved() -> None:
    module = _load()
    result = module.summarize(_rows("0.01", "0.02", "0.03"))
    assert result["total"] == "0.06"


def test_invalid_input_is_rejected() -> None:
    module = _load()
    for invalid in (
        "not-a-list",
        [],
        [{"id": "a", "amount": "1.234"}],
        [{"id": "a", "amount": "-1.00"}],
        [{"id": "a"}],
    ):
        assert module.summarize(invalid) == {"ok": False, "error": "invalid_rows"}


def test_output_shape() -> None:
    module = _load()
    result = module.summarize(_rows("1.00"))
    assert set(result) == {"ok", "total", "shares"}
    assert isinstance(result["total"], str)
    assert all(isinstance(value, str) for value in result["shares"].values())


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-numeric-aggregation-order"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "observe", "audit", "total", "allocate", "generalize"
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "total", "allocate", "generalize"}


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
