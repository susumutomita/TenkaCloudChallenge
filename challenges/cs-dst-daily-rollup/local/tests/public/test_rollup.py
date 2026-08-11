"""Intentionally incomplete public tests: the shipped starter passes all of them.

Every case here sits in an ordinary week. That is the blind spot: a fixed offset is
exactly right for 363 days a year.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "rollup.py"


def _load():
    spec = importlib.util.spec_from_file_location("participant_rollup", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load rollup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "daily_totals"):
        raise AssertionError("rollup.py must define daily_totals()")
    return module


def _event(identifier: str, at: str, amount: int) -> dict[str, object]:
    return {"id": identifier, "at": at, "amount": amount}


def test_totals_an_ordinary_week() -> None:
    module = _load()
    events = [
        _event("a", "2026-06-10T13:00:00Z", 10),
        _event("b", "2026-06-10T23:30:00Z", 5),
        _event("c", "2026-06-11T13:00:00Z", 7),
    ]
    result = module.daily_totals(events, "America/New_York", "2026-06-10", "2026-06-11")
    assert result["ok"] is True
    assert result["days"] == {"2026-06-10": 15, "2026-06-11": 7}


def test_every_day_in_the_range_is_reported() -> None:
    module = _load()
    result = module.daily_totals([], "Europe/Berlin", "2026-06-01", "2026-06-04")
    assert result["days"] == {
        "2026-06-01": 0,
        "2026-06-02": 0,
        "2026-06-03": 0,
        "2026-06-04": 0,
    }


def test_the_local_day_is_not_the_utc_day() -> None:
    module = _load()
    # 03:00Z on 11 June is still 10 June in New York.
    events = [_event("a", "2026-06-11T03:00:00Z", 42)]
    result = module.daily_totals(events, "America/New_York", "2026-06-10", "2026-06-11")
    assert result["days"] == {"2026-06-10": 42, "2026-06-11": 0}


def test_a_single_day_range_works() -> None:
    module = _load()
    events = [_event("a", "2026-06-10T16:00:00Z", 3)]
    result = module.daily_totals(events, "Europe/Berlin", "2026-06-10", "2026-06-10")
    assert result["days"] == {"2026-06-10": 3}


def test_invalid_input_is_rejected() -> None:
    module = _load()
    assert module.daily_totals([], "Not/AZone", "2026-06-01", "2026-06-02") == {
        "ok": False,
        "error": "invalid_timezone",
    }
    assert module.daily_totals([], "Europe/Berlin", "2026-06-02", "2026-06-01") == {
        "ok": False,
        "error": "invalid_range",
    }
    assert module.daily_totals(
        [_event("a", "not-a-time", 1)], "Europe/Berlin", "2026-06-01", "2026-06-02"
    ) == {"ok": False, "error": "invalid_events"}


def test_output_shape() -> None:
    module = _load()
    result = module.daily_totals([], "Europe/Berlin", "2026-06-01", "2026-06-01")
    assert set(result) == {"ok", "days"}
    assert all(isinstance(value, int) for value in result["days"].values())


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-dst-daily-rollup"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "observe", "audit", "rollup", "transition", "generalize"
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "rollup", "transition", "generalize"}


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
