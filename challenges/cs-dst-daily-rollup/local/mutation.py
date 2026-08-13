"""Break the reference ten ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_rollup import run

REFERENCE = (Path(__file__).parent / "reference" / "rollup.py").read_text(encoding="utf-8")
# Issue 440: scaffold-leftover guard は tests/hidden に check_*.py 1 本だけを許す。
# これは hidden test ではなく mutation suite が読む author 専用の mutant なので、
# reference/ と同格の mutants/ へ置く (参加者 image には元から入らない)。
UTC_GROUPING_MUTANT = (Path(__file__).parent / "mutants" / "sidecar_mutant.py").read_text(
    encoding="utf-8"
)
SEED = "mutation-suite-seed"

GROUPING = '        local_day = moment.astimezone(zone).date().isoformat()'

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "divides the instant into 86400-second blocks",
        GROUPING,
        '        local_day = date.fromordinal(int(moment.timestamp()) // 86400 + 719163).isoformat()',
    ),
    (
        "applies the range's first offset to every instant",
        GROUPING,
        '        _offset = datetime.combine(first, datetime.min.time(), tzinfo=zone).utcoffset()\n'
        '        local_day = (moment + (_offset or timedelta(0))).date().isoformat()',
    ),
    (
        "groups by the UTC day and never converts",
        GROUPING,
        "        local_day = moment.date().isoformat()",
    ),
    (
        "uses the zone's standard offset all year",
        GROUPING,
        '        _std = datetime(moment.year, 1, 15, tzinfo=zone).utcoffset()\n'
        '        local_day = (moment + (_std or timedelta(0))).date().isoformat()',
    ),
    (
        "drops events that fall outside the range instead of ignoring them silently",
        "        if local_day in days:\n            days[local_day] += amount",
        "        days[local_day] = days.get(local_day, 0) + amount",
    ),
    (
        "omits days that had no events",
        "    days: dict[str, int] = {}\n    cursor = first\n    while cursor <= last:\n        days[cursor.isoformat()] = 0\n        cursor += timedelta(days=1)",
        "    days: dict[str, int] = {}\n    cursor = first",
    ),
    (
        "treats the end of the range as exclusive",
        "    while cursor <= last:\n        days[cursor.isoformat()] = 0",
        "    while cursor < last:\n        days[cursor.isoformat()] = 0",
    ),
    (
        # The grouping key is already right; only the membership test still reasons in
        # UTC. Near either end of the range that drops an event whose local day is in
        # range but whose UTC date is not.
        "keeps the local grouping key but filters the range by the UTC date",
        "        if local_day in days:\n            days[local_day] += amount",
        "        if first <= moment.date() <= last and local_day in days:\n"
        "            days[local_day] += amount",
    ),
    (
        "accepts an instant with no offset as though it were UTC",
        "    return moment if moment.tzinfo is not None else None",
        "    return moment if moment.tzinfo is not None else moment.replace(tzinfo=timezone.utc)",
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


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
        if before not in REFERENCE:
            print(f"BROKEN {name}: mutation target is missing")
            survivors.append(name)
            continue
        source = REFERENCE.replace(before, after, 1)
        try:
            failures = run(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    utc_name = "converts for display but groups by the UTC day"
    try:
        failures = run(_load(UTC_GROUPING_MUTANT), SEED)
    except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
        failures = [type(error).__name__]
    if failures:
        print(f"killed {utc_name}")
    else:
        print(f"SURVIVED {utc_name}")
        survivors.append(utc_name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
