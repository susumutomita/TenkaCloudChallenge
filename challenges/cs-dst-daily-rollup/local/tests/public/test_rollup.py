"""Intentionally incomplete public tests: the shipped starter passes all of them.

Every `daily_totals` case here sits in an ordinary week. That is the blind spot: a
fixed offset is exactly right for 363 days a year.

The one `counterexample` test only tries the two pairs the statement works through.
It reports "not implemented yet" while the function is still the shipped placeholder,
and it says nothing about the zones and range starts the graded run also tries.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

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


class NotImplementedYet(Exception):
    """The function under test is still the shipped placeholder: reported, not failed."""


def _event(identifier: str, at: str, amount: int) -> dict[str, object]:
    return {"id": identifier, "at": at, "amount": amount}


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment.astimezone(timezone.utc) if moment.tzinfo is not None else None


def _is_switch_day(zone: ZoneInfo, day: date) -> bool:
    start = datetime(day.year, day.month, day.day, tzinfo=zone).astimezone(timezone.utc)
    following = day + timedelta(days=1)
    end = datetime(following.year, following.month, following.day, tzinfo=zone).astimezone(timezone.utc)
    return end - start != timedelta(hours=24)


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


def test_counterexample_for_the_statement_examples() -> None:
    """The two New York pairs the statement works through, checked as a property.

    Passing here says nothing about other zones or about a range that starts months
    before the switch; the graded run tries those too.
    """
    module = _load()
    build = getattr(module, "counterexample", None)
    assert callable(build), "rollup.py must define counterexample()"
    zone = ZoneInfo("America/New_York")
    for start, switch in ((date(2026, 10, 31), date(2026, 11, 1)), (date(2026, 3, 7), date(2026, 3, 8))):
        where = f"start {start}, switch {switch}"
        result = build("America/New_York", start.isoformat(), switch.isoformat())
        if isinstance(result, dict) and result.get("events") == []:
            raise NotImplementedYet(
                "counterexample() はまだ出来事を返していません (not implemented yet: it still returns no event)"
            )
        assert isinstance(result, dict) and set(result) == {"end_day", "events"}, (
            f"{where}: counterexample() must return a dict with exactly end_day and events"
        )
        end = date.fromisoformat(str(result["end_day"]))
        assert switch <= end and (end - start).days <= 400, (
            f"{where}: the range must contain the switch day and be at most 400 days long"
        )
        events = result["events"]
        assert isinstance(events, list) and len(events) == 1, (
            f"{where}: the counterexample must contain exactly one event"
        )
        event = events[0]
        assert isinstance(event, dict) and set(event) == {"id", "at", "amount"}, (
            f"{where}: the event must have exactly id, at and amount"
        )
        assert type(event["amount"]) is int and event["amount"] >= 1, (
            f"{where}: amount must be an integer, 1 or more"
        )
        moment = _instant(event["at"])
        assert moment is not None, f"{where}: at must be an instant carrying an offset"
        true_day = moment.astimezone(zone).date()
        fixed_offset = datetime(start.year, start.month, start.day, tzinfo=zone).utcoffset()
        fixed_day = (moment + (fixed_offset or timedelta(0))).date()
        assert start <= true_day <= end, f"{where}: the event's real day must lie inside the range"
        assert fixed_day != true_day, (
            f"{where}: the fixed offset files this event under its real day, so no day comes up short"
        )
        assert not _is_switch_day(zone, true_day), (
            f"{where}: the day that comes up short is a switch day; an ordinary day must"
        )


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-dst-daily-rollup"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "observe", "audit", "rollup", "transition", "counterexample"
    ]
    assert [item["kind"] for item in config["checkpoints"]] == [
        "answer", "answer", "answer", "code", "code", "code"
    ]
    files = server.starter_payload()
    assert "def counterexample" in files["rollup.py"]
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "rollup", "transition", "counterexample"}


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
    skipped: list[str] = []
    for name, test in selected.items():
        try:
            test()
            print(f"pass {name}")
        except NotImplementedYet as error:
            # The subject is still the shipped placeholder. Said out loud, not failed:
            # the daily_totals tests are what the untouched starter is expected to pass.
            skipped.append(name)
            print(f"skip {name}: {error}")
        except Exception as error:  # noqa: BLE001 - test runner reports each failure
            failures.append(name)
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    passed = len(selected) - len(skipped)
    print(f"all passed ({passed})" + (f", {len(skipped)} not implemented yet" if skipped else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
