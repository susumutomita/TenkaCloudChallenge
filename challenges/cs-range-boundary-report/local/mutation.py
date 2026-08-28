"""Break the reference thirteen ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_report import run

REFERENCE = (Path(__file__).parent / "reference" / "report.py").read_text(encoding="utf-8")
# Issue 440: scaffold-leftover guard は tests/hidden に check_*.py 1 本だけを許す。
# これは hidden test ではなく mutation suite が読む author 専用の mutant なので、
# reference/ と同格の mutants/ へ置く (参加者 image には元から入らない)。
MATERIALISED_WINDOW_MUTANT = (
    Path(__file__).parent / "mutants" / "materialised_window_mutant.py"
).read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "counts the day the report runs as well",
        "        if start <= day < end:",
        "        if start <= day <= end:",
    ),
    (
        "drops the first day of the window",
        "        if start <= day < end:",
        "        if start < day < end:",
    ),
    (
        "measures the window by subtraction and keeps both ends",
        "        if start <= day < end:",
        "        if 0 <= (end - day).days < days:",
    ),
    (
        "starts the window one day late",
        "    start = end - timedelta(days=days)",
        "    start = end - timedelta(days=days - 1)",
    ),
    (
        "starts the window one day early",
        "    start = end - timedelta(days=days)",
        "    start = end - timedelta(days=days + 1)",
    ),
    (
        "slides the whole window one day forward",
        "    start = end - timedelta(days=days)",
        "    end = end + timedelta(days=1)\n    start = end - timedelta(days=days)",
    ),
    (
        "ignores the window length it was given",
        "    start = end - timedelta(days=days)",
        "    start = end - timedelta(days=WINDOW_DAYS)",
    ),
    (
        "reports an end that is the last day counted",
        '        "end": end.isoformat(),',
        '        "end": (end - timedelta(days=1)).isoformat(),',
    ),
    (
        "reports a first day it did not actually use",
        '        "start": start.isoformat(),',
        '        "start": (start + timedelta(days=1)).isoformat(),',
    ),
    (
        "counts rows instead of totalling them",
        "            total += count",
        "            total += 1",
    ),
    (
        "counts each calendar day at most once",
        "    parsed: list[tuple[date, int]] = []\n    for row in rows:",
        "    parsed: list[tuple[date, int]] = []\n    seen_days: set[date] = set()\n    for row in rows:",
    ),
    (
        "sorts the caller's ledger in place",
        "    parsed: list[tuple[date, int]] = []\n    for row in rows:",
        '    parsed: list[tuple[date, int]] = []\n'
        '    if isinstance(rows, list):\n'
        '        rows.sort(key=lambda item: str(item.get("date")) if isinstance(item, dict) else "")\n'
        "    for row in rows:",
    ),
    (
        "accepts a window length of zero or less",
        "    if type(days) is not int or days < 1 or days > MAX_WINDOW_DAYS:",
        "    if type(days) is not int or days > MAX_WINDOW_DAYS:",
    ),
]

# The de-duplicating mutant needs a second edit in the same function body; keeping it
# next to its first half makes the pair visible instead of hiding it in a helper.
DEDUPE_SECOND_EDIT = (
    "        parsed.append((day, count))",
    "        if day in seen_days:\n            continue\n"
    "        seen_days.add(day)\n        parsed.append((day, count))",
)


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


def _mutate(name: str, before: str, after: str) -> str | None:
    if before not in REFERENCE:
        return None
    source = REFERENCE.replace(before, after, 1)
    if name == "counts each calendar day at most once":
        head, tail = DEDUPE_SECOND_EDIT
        if head not in source:
            return None
        source = source.replace(head, tail, 1)
    return source


def main() -> int:
    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survivors: list[str] = []
    for name, before, after in MUTATIONS:
        source = _mutate(name, before, after)
        if source is None:
            print(f"BROKEN {name}: mutation target is missing")
            survivors.append(name)
            continue
        try:
            failures = run(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    materialised_name = "enumerates the window as a set of dates, one day too large"
    try:
        failures = run(_load(MATERIALISED_WINDOW_MUTANT), SEED)
    except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
        failures = [type(error).__name__]
    if failures:
        print(f"killed {materialised_name}")
    else:
        print(f"SURVIVED {materialised_name}")
        survivors.append(materialised_name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
