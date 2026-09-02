"""Break the reference on purpose and require the hidden properties to notice.

Two functions are graded from `rollup.py`, so two families of mutants live here:
`daily_totals` mutants (the grouping key, the range, the contract) and
`counterexample` mutants (the last checkpoint's construction). A green run of the
reference proves nothing about whether the checker would reject a wrong answer; this
suite is what keeps the hidden properties honest.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_rollup import check_counterexample, run

REFERENCE = (Path(__file__).parent / "reference" / "rollup.py").read_text(encoding="utf-8")
STARTER = (Path(__file__).parent / "starter" / "rollup.py").read_text(encoding="utf-8")
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


#: `counterexample` mutants. Each source replaces the reference's `counterexample`
#: (everything from `def counterexample` to the end of the file); the helpers above it
#: — `_midnight_offset`, the parsers, `ZoneInfo` — stay available. Every one of these is
#: a construction a participant could plausibly submit, and every one must be rejected
#: by the property alone: the checker holds no expected answer to compare against.
COUNTEREXAMPLE_MUTATIONS: list[tuple[str, str]] = [
    (
        "transcribes the statement: the event sits on the switch day itself at 23:30",
        '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    day = date.fromisoformat(switch_day)
    local = datetime(day.year, day.month, day.day, 23, 30, tzinfo=zone)
    at = local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"end_day": (day + timedelta(days=1)).isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
''',
    ),
    (
        "always applies the clocks-go-back rule: 23:30 on the day after the switch",
        '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    day = date.fromisoformat(switch_day) + timedelta(days=1)
    local = datetime(day.year, day.month, day.day, 23, 30, tzinfo=zone)
    at = local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"end_day": day.isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
''',
    ),
    (
        "always applies the clocks-go-forward rule: 00:30 on the day after the switch",
        '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    day = date.fromisoformat(switch_day) + timedelta(days=1)
    local = datetime(day.year, day.month, day.day, 0, 30, tzinfo=zone)
    at = local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"end_day": day.isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
''',
    ),
    (
        # Right on every start near the switch; wrong when the start already carries the
        # offset the switch moves to, because then the days after the switch are not
        # misplaced at all.
        "picks the boundary hour from the switch's direction instead of the start's offset",
        '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    switch = date.fromisoformat(switch_day)
    day = switch + timedelta(days=1)
    before = _midnight_offset(zone, switch)
    after = _midnight_offset(zone, day)
    hour, minute = (23, 30) if before > after else (0, 30)
    local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone)
    at = local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"end_day": day.isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
''',
    ),
    (
        "converts the wall-clock time to UTC with the start's offset instead of the day's own",
        '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    first = date.fromisoformat(start_day)
    switch = date.fromisoformat(switch_day)
    stale = _midnight_offset(zone, first)
    candidate = first + timedelta(days=1)
    while (candidate - first).days <= 400:
        current = _midnight_offset(zone, candidate)
        following = _midnight_offset(zone, candidate + timedelta(days=1))
        if current != stale and current == following:
            hour, minute = (23, 30) if stale > current else (0, 30)
            naive = datetime(candidate.year, candidate.month, candidate.day, hour, minute)
            at = (naive - stale).replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            return {"end_day": max(candidate, switch).isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
        candidate += timedelta(days=1)
    return {"end_day": switch_day, "events": []}
''',
    ),
    (
        "puts the event at noon, nowhere near a day boundary",
        '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    day = date.fromisoformat(switch_day) + timedelta(days=1)
    local = datetime(day.year, day.month, day.day, 12, 0, tzinfo=zone)
    at = local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"end_day": day.isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
''',
    ),
    (
        # The reference's own day scan with the whole-hour window the statement once
        # named instead of the boundary second. Right on every whole-hour switch; on the
        # thirty-minute one, 00:30 read thirty minutes early is 00:00 of the same day.
        "hard-codes a whole-hour window (23:30 / 00:30) on a correct day scan",
        '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    first = date.fromisoformat(start_day)
    switch = date.fromisoformat(switch_day)
    stale = _midnight_offset(zone, first)
    candidate = first + timedelta(days=1)
    while (candidate - first).days <= 400:
        current = _midnight_offset(zone, candidate)
        following = _midnight_offset(zone, candidate + timedelta(days=1))
        if current != stale and current == following:
            hour, minute = (23, 30) if stale > current else (0, 30)
            local = datetime(candidate.year, candidate.month, candidate.day, hour, minute, tzinfo=zone)
            at = local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            return {"end_day": max(candidate, switch).isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
        candidate += timedelta(days=1)
    return {"end_day": switch_day, "events": []}
''',
    ),
    (
        "returns two events instead of exactly one",
        '''
def counterexample(timezone_name, start_day, switch_day):
    result = _reference_counterexample(timezone_name, start_day, switch_day)
    event = dict(result["events"][0])
    event["id"] = "second"
    return {"end_day": result["end_day"], "events": [result["events"][0], event]}
''',
    ),
    (
        "returns an instant with no offset",
        '''
def counterexample(timezone_name, start_day, switch_day):
    result = _reference_counterexample(timezone_name, start_day, switch_day)
    event = dict(result["events"][0])
    event["at"] = event["at"].rstrip("Z")
    return {"end_day": result["end_day"], "events": [event]}
''',
    ),
    (
        "returns an amount of zero, so nothing can come up short",
        '''
def counterexample(timezone_name, start_day, switch_day):
    result = _reference_counterexample(timezone_name, start_day, switch_day)
    event = dict(result["events"][0])
    event["amount"] = 0
    return {"end_day": result["end_day"], "events": [event]}
''',
    ),
    (
        "ends the range before the switch day when the misplaced day comes first",
        '''
def counterexample(timezone_name, start_day, switch_day):
    result = _reference_counterexample(timezone_name, start_day, switch_day)
    moment = _parse_instant(result["events"][0]["at"])
    real_day = moment.astimezone(ZoneInfo(timezone_name)).date()
    return {"end_day": real_day.isoformat(), "events": result["events"]}
''',
    ),
]

#: Walks the range one second at a time, asking both rollups about each instant. It is
#: a correct oracle and far too slow for the graded triples: the ones whose start lies
#: months before the switch put millions of seconds before the first misplaced one.
#: Run through the verifier, because in-process it would hang this suite.
BRUTE_FORCE_COUNTEREXAMPLE = '''
def counterexample(timezone_name, start_day, switch_day):
    zone = ZoneInfo(timezone_name)
    first = date.fromisoformat(start_day)
    switch = date.fromisoformat(switch_day)
    stale = _midnight_offset(zone, first)
    moment = datetime(first.year, first.month, first.day, tzinfo=zone).astimezone(timezone.utc)
    limit = moment + timedelta(days=400)
    while moment < limit:
        real_day = moment.astimezone(zone).date()
        fixed_day = (moment + stale).date()
        if fixed_day != real_day and _midnight_offset(zone, real_day) == _midnight_offset(zone, real_day + timedelta(days=1)):
            at = moment.strftime("%Y-%m-%dT%H:%M:%SZ")
            return {"end_day": max(real_day, switch).isoformat(), "events": [{"id": "e", "at": at, "amount": 1}]}
        moment += timedelta(seconds=1)
    return {"end_day": switch_day, "events": []}
'''


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


def _counterexample_mutant(source: str) -> str:
    """The reference with its `counterexample` swapped for `source`. The original stays
    reachable as `_reference_counterexample` so a mutant can perturb its output."""
    head, tail = REFERENCE.split("def counterexample", 1)
    return head + "def _reference_counterexample" + tail + "\n" + source


def main() -> int:
    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")
    if check_counterexample(_load(REFERENCE), SEED):
        print("the reference counterexample does not pass its hidden property")
        return 1
    print("reference counterexample: passes")

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

    for name, source in COUNTEREXAMPLE_MUTATIONS:
        try:
            failures = check_counterexample(_load(_counterexample_mutant(source)), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed counterexample {name} ({failures[0]})")
        else:
            print(f"SURVIVED counterexample {name}")
            survivors.append(f"counterexample {name}")

    # The verifier-level near misses: the shipped placeholder, a file without the
    # function at all, and the one-second walk that only the time limit can stop.
    from verifier.server import evaluate  # noqa: PLC0415 - imported late, after sys.path

    verifier_checks: list[tuple[str, str, bool]] = [
        ("verifier accepts the reference counterexample", REFERENCE, True),
        ("verifier accepts the reference rollup", REFERENCE, True),
        ("verifier rejects the shipped placeholder counterexample", STARTER, False),
        (
            "verifier rejects a file without counterexample()",
            REFERENCE.split("def counterexample", 1)[0],
            False,
        ),
        (
            "verifier stops the one-second walk at the time limit",
            _counterexample_mutant(BRUTE_FORCE_COUNTEREXAMPLE),
            False,
        ),
    ]
    for name, source, expected in verifier_checks:
        checkpoint = "rollup" if name.endswith("rollup") else "counterexample"
        correct, message = evaluate(checkpoint, source)
        if correct is expected:
            print(f"{'PASS' if expected else 'killed'} {name}" + (f" ({message})" if message else ""))
        else:
            print(f"{'FAIL' if expected else 'SURVIVED'} {name}")
            survivors.append(name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    total = len(MUTATIONS) + 1 + len(COUNTEREXAMPLE_MUTATIONS) + 1
    print(f"all {total} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
