"""Hidden property checks for the two code checkpoints.

The lesson of this problem is about *the ends of a range*, so nothing here is
sampled or approximate. Every case names a calendar day, says whether that day is
inside the window the contract describes, and asks the submission for a number that
can only be right if it agrees. The anchor day and every count are derived from the
run's seed, so a submission that hardcodes a total from someone else's deployment
fails on the first case.

`repair` fixes the window for the default seven days. `generalize` keeps the same
rule when the window length changes, when the window crosses a month, a year or a
leap day, when days inside it have no rows at all, and when the caller's ledger must
come back untouched.
"""

from __future__ import annotations

import copy
import hashlib
import random
from datetime import date, timedelta
from types import ModuleType

WINDOW_DAYS = 7
RESULT_KEYS = {"ok", "start", "end", "days", "total", "rows"}

# `days` is a graded argument and `None` is one of the values that must be rejected,
# so "call without days" needs a sentinel of its own rather than reusing None.
_OMIT = object()


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _anchor(seed: str, label: str) -> date:
    """A seeded run date, far enough inside the calendar for any window to fit."""
    return date(2027, 1, 1) + timedelta(days=_rng(seed, f"{label}:anchor").randrange(60, 900))


def _counts(seed: str, label: str, span: int) -> list[int]:
    """Row counts of at least two, so totalling and row-counting cannot coincide."""
    rng = _rng(seed, f"{label}:counts")
    return [rng.randrange(2, 500) for _ in range(span)]


def _call(module: ModuleType, rows: object, today: object, days: object = _OMIT) -> object:
    try:
        if days is _OMIT:
            return module.report_total(rows, today)
        return module.report_total(rows, today, days)
    except Exception as error:  # noqa: BLE001 - a raising submission is a failed property
        return {"raised": type(error).__name__}


def _shape_failures(result: object, where: str) -> list[str]:
    if not isinstance(result, dict):
        return [f"{where}: report_total did not return a dictionary"]
    if result.get("ok") is not True:
        return [f"{where}: report_total did not report success"]
    if set(result) != RESULT_KEYS:
        return [f"{where}: the result keys are not the documented ones"]
    return []


def _window_case(
    module: ModuleType,
    seed: str,
    label: str,
    today: date,
    days: int,
    *,
    pass_days: bool = True,
) -> list[str]:
    """Every day around the window carries a row; only the window may be totalled."""
    failures: list[str] = []
    start = today - timedelta(days=days)
    offsets = list(range(-(days + 2), 3))
    counts = _counts(seed, f"{label}:{days}", len(offsets))
    rows: list[dict[str, object]] = []
    expected_total = 0
    expected_rows = 0
    for count, offset in zip(counts, offsets):
        day = today + timedelta(days=offset)
        rows.append({"date": day.isoformat(), "count": count})
        if start <= day < today:
            expected_total += count
            expected_rows += 1

    result = _call(module, rows, today.isoformat(), days if pass_days else _OMIT)
    failures.extend(_shape_failures(result, label))
    if failures:
        return failures
    assert isinstance(result, dict)
    if result.get("start") != start.isoformat():
        failures.append(f"{label}: the reported first day of the window is not {start.isoformat()}")
    if result.get("end") != today.isoformat():
        failures.append(f"{label}: the reported end of the window is not {today.isoformat()}")
    if result.get("days") != days:
        failures.append(f"{label}: the reported window length is not {days}")
    if result.get("total") != expected_total:
        failures.append(f"{label}: the total covers a different set of days than the contract")
    if result.get("rows") != expected_rows:
        failures.append(f"{label}: the number of rows counted does not match the window")
    return failures


def _boundary_probes(module: ModuleType, seed: str, label: str, today: date, days: int) -> list[str]:
    """One row, one day, one verdict — the ends of the range in isolation."""
    failures: list[str] = []
    start = today - timedelta(days=days)
    probes = (
        ("the day the report runs", today, False),
        ("the day after the report runs", today + timedelta(days=1), False),
        ("the last day of the window", today - timedelta(days=1), True),
        ("the first day of the window", start, True),
        ("the day before the window", start - timedelta(days=1), False),
    )
    amounts = _counts(seed, f"{label}:probes", len(probes))
    for amount, (name, day, inside) in zip(amounts, probes):
        rows = [{"date": day.isoformat(), "count": amount}]
        result = _call(module, rows, today.isoformat(), days)
        failures.extend(_shape_failures(result, f"{label}/{name}"))
        if not isinstance(result, dict) or result.get("ok") is not True:
            continue
        expected_total = amount if inside else 0
        expected_rows = 1 if inside else 0
        if result.get("total") != expected_total:
            verb = "was not counted" if inside else "was counted"
            failures.append(f"{label}: a row on {name} ({day.isoformat()}) {verb}")
        if result.get("rows") != expected_rows:
            failures.append(f"{label}: the row count disagrees about {name} ({day.isoformat()})")
    return failures


def _empty_and_equivalence(module: ModuleType, seed: str, label: str, today: date) -> list[str]:
    failures: list[str] = []
    empty = _call(module, [], today.isoformat())
    failures.extend(_shape_failures(empty, f"{label}/empty"))
    if isinstance(empty, dict) and empty.get("ok") is True:
        if empty.get("total") != 0 or empty.get("rows") != 0:
            failures.append(f"{label}: an empty ledger did not total zero over zero rows")

    counts = _counts(seed, f"{label}:equivalence", 3)
    rows = [
        {"date": (today - timedelta(days=offset)).isoformat(), "count": count}
        for offset, count in zip((1, 4, 7), counts)
    ]
    as_object = _call(module, rows, today)
    as_string = _call(module, rows, today.isoformat())
    if as_object != as_string:
        failures.append(f"{label}: a date object and its ISO string produced different reports")

    repeated = _call(module, rows, today.isoformat())
    if repeated != as_string:
        failures.append(f"{label}: two identical calls produced different reports")
    return failures


def _documented_errors(module: ModuleType, label: str, today: date) -> list[str]:
    failures: list[str] = []
    good = [{"date": (today - timedelta(days=2)).isoformat(), "count": 3}]
    cases: tuple[tuple[str, object, object, object], ...] = (
        ("invalid_days", good, today, 0),
        ("invalid_days", good, today, -1),
        ("invalid_days", good, today, "7"),
        ("invalid_days", good, today, 7.0),
        ("invalid_days", good, today, None),
        ("invalid_today", good, "2027-13-01", 7),
        ("invalid_today", good, "", 7),
        ("invalid_today", good, None, 7),
        ("invalid_today", good, 20270101, 7),
        ("invalid_rows", "not rows", today, 7),
        ("invalid_rows", None, today, 7),
        ("invalid_rows", [7], today, 7),
        ("invalid_rows", [{"count": 3}], today, 7),
        ("invalid_rows", [{"date": "not-a-day", "count": 3}], today, 7),
        ("invalid_rows", [{"date": today.isoformat(), "count": "3"}], today, 7),
        ("invalid_rows", [{"date": today.isoformat(), "count": 1.5}], today, 7),
    )
    for expected, rows, when, days in cases:
        result = _call(module, rows, when, days)
        if result != {"ok": False, "error": expected}:
            failures.append(f"{label}: bad input did not return the documented {expected}")
    return failures


def _sparse_case(module: ModuleType, seed: str, label: str, today: date) -> list[str]:
    """A window is a run of calendar days, not the last few days that happen to have rows."""
    failures: list[str] = []
    start = today - timedelta(days=WINDOW_DAYS)
    populated = (-9, -8, -7, -5, -2, 0, 1)
    counts = _counts(seed, f"{label}:sparse", len(populated))
    rows: list[dict[str, object]] = []
    expected_total = 0
    expected_rows = 0
    for count, offset in zip(counts, populated):
        day = today + timedelta(days=offset)
        rows.append({"date": day.isoformat(), "count": count})
        if start <= day < today:
            expected_total += count
            expected_rows += 1

    result = _call(module, rows, today.isoformat())
    failures.extend(_shape_failures(result, f"{label}/sparse"))
    if isinstance(result, dict) and result.get("ok") is True:
        if result.get("total") != expected_total or result.get("rows") != expected_rows:
            failures.append(
                f"{label}: days inside the window with no rows moved the window instead of "
                "contributing nothing"
            )
    return failures


def _repeats_and_order(module: ModuleType, seed: str, label: str, today: date) -> list[str]:
    failures: list[str] = []
    counts = _counts(seed, f"{label}:repeats", 6)
    offsets = (-3, -3, -3, -6, -1, -1)
    rows = [
        {"date": (today + timedelta(days=offset)).isoformat(), "count": count}
        for offset, count in zip(offsets, counts)
    ]
    result = _call(module, rows, today.isoformat())
    failures.extend(_shape_failures(result, f"{label}/repeats"))
    if isinstance(result, dict) and result.get("ok") is True:
        if result.get("total") != sum(counts) or result.get("rows") != len(rows):
            failures.append(f"{label}: several rows on the same day were not all counted")

    shuffled = list(rows)
    _rng(seed, f"{label}:shuffle").shuffle(shuffled)
    if _call(module, shuffled, today.isoformat()) != result:
        failures.append(f"{label}: the total depended on the order the rows arrived in")
    return failures


def _leaves_the_ledger_alone(module: ModuleType, seed: str, label: str, today: date) -> list[str]:
    counts = _counts(seed, f"{label}:untouched", 6)
    offsets = (2, -1, -9, -4, -7, 0)
    rows = [
        {"date": (today + timedelta(days=offset)).isoformat(), "count": count}
        for offset, count in zip(offsets, counts)
    ]
    snapshot = copy.deepcopy(rows)
    _call(module, rows, today.isoformat())
    if rows != snapshot:
        return [f"{label}: reporting rearranged or edited the caller's ledger"]
    return []


def _repair_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """The default seven-day window covers exactly the seven days before the run date."""
    today = _anchor(seed, phase)
    failures = _window_case(module, seed, f"{phase}/default", today, WINDOW_DAYS, pass_days=False)
    failures.extend(_window_case(module, seed, f"{phase}/explicit", today, WINDOW_DAYS))
    failures.extend(_boundary_probes(module, seed, f"{phase}/edges", today, WINDOW_DAYS))
    failures.extend(_empty_and_equivalence(module, seed, f"{phase}/basics", today))
    failures.extend(_documented_errors(module, f"{phase}/errors", today))
    return failures


def _generalize_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """The same rule holds for any window length and wherever it lands in the calendar."""
    failures = _repair_properties(module, seed, phase)
    today = _anchor(seed, phase)

    for days in (1, 2, 3, 30, 365):
        failures.extend(_window_case(module, seed, f"{phase}/length-{days}", today, days))
        failures.extend(_boundary_probes(module, seed, f"{phase}/edges-{days}", today, days))

    # Windows that do not stay inside one month, one year, or one non-leap February.
    calendar_cases = (
        ("month-end", date(2027, 3, 3), WINDOW_DAYS),
        ("year-end", date(2027, 1, 4), WINDOW_DAYS),
        ("leap-day", date(2028, 3, 3), WINDOW_DAYS),
        ("across-a-leap-year", date(2029, 3, 1), 365),
    )
    for name, when, days in calendar_cases:
        failures.extend(_window_case(module, seed, f"{phase}/{name}", when, days))
        failures.extend(_boundary_probes(module, seed, f"{phase}/{name}-edges", when, days))

    failures.extend(_sparse_case(module, seed, f"{phase}/gaps", today))
    failures.extend(_repeats_and_order(module, seed, f"{phase}/repeats", today))
    failures.extend(_leaves_the_ledger_alone(module, seed, f"{phase}/untouched", today))
    return failures


def check_repair(module: ModuleType, seed: str) -> list[str]:
    return _repair_properties(module, seed, "repair-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "full-run")
