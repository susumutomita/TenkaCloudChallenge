"""Intentionally incomplete public tests: the shipped starter passes all of them.

They check the reported window, days far outside it, the first day inside it, empty
input, repeats, order and every documented error. Not one of them puts a row on the
single day where the contract and the starter disagree, and that is exactly why a
report that counts the wrong days goes green.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "report.py"

TODAY = date(2026, 6, 18)


def _load():
    spec = importlib.util.spec_from_file_location("participant_report", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load report.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "report_total"):
        raise AssertionError("report.py must define report_total()")
    return module


def _day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def _row(offset: int, count: int) -> dict[str, object]:
    return {"date": _day(offset), "count": count}


def test_totals_the_middle_of_the_window() -> None:
    module = _load()
    rows = [_row(-6, 10), _row(-5, 20), _row(-4, 30), _row(-3, 40), _row(-2, 5)]
    result = module.report_total(rows, TODAY.isoformat())
    assert result["ok"] is True
    assert result["total"] == 105
    assert result["rows"] == 5


def test_reports_the_window_it_was_asked_for() -> None:
    module = _load()
    result = module.report_total([], TODAY.isoformat())
    assert result["start"] == _day(-7)
    assert result["end"] == _day(0)
    assert result["days"] == 7


def test_the_first_day_of_the_window_is_counted() -> None:
    module = _load()
    result = module.report_total([_row(-7, 77)], TODAY.isoformat())
    assert result["total"] == 77
    assert result["rows"] == 1


def test_days_before_the_window_are_ignored() -> None:
    module = _load()
    rows = [_row(-8, 100), _row(-30, 200), _row(-365, 300)]
    result = module.report_total(rows, TODAY.isoformat())
    assert result["total"] == 0
    assert result["rows"] == 0


def test_days_after_the_report_are_ignored() -> None:
    module = _load()
    rows = [_row(1, 100), _row(9, 200)]
    result = module.report_total(rows, TODAY.isoformat())
    assert result["total"] == 0


def test_empty_input_totals_zero() -> None:
    module = _load()
    result = module.report_total([], TODAY.isoformat())
    assert result["ok"] is True
    assert result["total"] == 0
    assert result["rows"] == 0


def test_repeats_and_order_do_not_matter() -> None:
    module = _load()
    rows = [_row(-2, 4), _row(-6, 9), _row(-2, 6), _row(-4, 1), _row(-2, 5)]
    result = module.report_total(rows, TODAY.isoformat())
    assert result["total"] == 25
    assert result["rows"] == 5


def test_a_date_object_and_an_iso_string_agree() -> None:
    module = _load()
    rows = [_row(-3, 11), _row(-1, 12)]
    assert module.report_total(rows, TODAY) == module.report_total(rows, TODAY.isoformat())


def test_invalid_input_is_rejected() -> None:
    module = _load()
    rows = [_row(-3, 11)]
    assert module.report_total(rows, TODAY, 0) == {"ok": False, "error": "invalid_days"}
    assert module.report_total(rows, TODAY, "7") == {"ok": False, "error": "invalid_days"}
    assert module.report_total(rows, "2026-13-01") == {"ok": False, "error": "invalid_today"}
    assert module.report_total(rows, None) == {"ok": False, "error": "invalid_today"}
    assert module.report_total("not rows", TODAY) == {"ok": False, "error": "invalid_rows"}
    assert module.report_total([{"count": 3}], TODAY) == {"ok": False, "error": "invalid_rows"}
    assert module.report_total([{"date": _day(-3), "count": "3"}], TODAY) == {
        "ok": False,
        "error": "invalid_rows",
    }


def test_output_shape() -> None:
    module = _load()
    result = module.report_total([_row(-3, 11)], TODAY.isoformat())
    assert set(result) == {"ok", "start", "end", "days", "total", "rows"}
    assert date.fromisoformat(str(result["start"])) < date.fromisoformat(str(result["end"]))
    assert isinstance(result["total"], int) and isinstance(result["rows"], int)


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-range-boundary-report"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "observe", "repair", "generalize"
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "repair", "generalize"}


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
