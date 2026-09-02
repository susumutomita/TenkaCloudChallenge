"""Hidden property checks for the three code checkpoints.

The claim is about two days a year — and about every day after them, once a rollup
reads its offset at the start of the range and keeps it. Nothing here is sampled or
timed: the checker builds its own expectation with the same calendar the contract
names, and every zone and date is derived from the verifier seed, so a submission
cannot special-case the week it saw in the public tests.

The transitions used are real ones from the system tz database. Every zone used has a
local midnight on every day, unambiguous and existing, so a local day always runs from
its own 00:00 to the next — the lesson here is that a day is not always 24 hours long,
not that a wall-clock time can fail to exist at all. The rollup checkpoints use whole-hour
switches away from midnight; the counterexample run adds a zone whose switch is thirty
minutes and one whose switch sits on the day boundary itself.

The last checkpoint is graded as a property, never against an expected value: the
submission's `counterexample` is called with public parameters, and the one event it
returns is totalled both the fixed-offset way and the calendar's way. It passes when
some day inside the range that is not a switch day comes up short under the fixed offset.
"""

from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta, timezone
from types import ModuleType
from typing import Callable
from zoneinfo import ZoneInfo

ZONES = (
    "America/New_York",
    "Europe/Berlin",
    "Australia/Sydney",
    "Pacific/Auckland",
    "America/Denver",
    "Europe/London",
)


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def transitions(zone_name: str, year: int) -> list[date]:
    """Every local date in `year` that is not twenty-four hours long.

    Found by measuring each local day from its own midnight to the next, rather than
    by watching a UTC cursor: a UTC-based scan reports the day *after* an evening
    switch, which is an ordinary 24-hour day and would make the evidence untrue.
    """
    zone = ZoneInfo(zone_name)
    found: list[date] = []
    cursor = date(year, 1, 1)
    while cursor.year == year:
        if _is_switch_day(zone, cursor):
            found.append(cursor)
        cursor += timedelta(days=1)
    return found


def pick_zone_and_day(seed: str, label: str) -> tuple[str, date]:
    """A zone and one of its real transition days, both moving with the seed."""
    rng = _rng(seed, label)
    zone_name = ZONES[rng.randrange(len(ZONES))]
    year = 2026 + rng.randrange(0, 3)
    days = transitions(zone_name, year)
    return zone_name, days[rng.randrange(len(days))]


def _local_midnight(zone: ZoneInfo, day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=zone)


def _is_switch_day(zone: ZoneInfo, day: date) -> bool:
    """True when the local day is not twenty-four hours long."""
    start = _local_midnight(zone, day).astimezone(timezone.utc)
    end = _local_midnight(zone, day + timedelta(days=1)).astimezone(timezone.utc)
    return end - start != timedelta(hours=24)


def _midnight_offset(zone: ZoneInfo, day: date) -> timedelta:
    offset = _local_midnight(zone, day).utcoffset()
    return offset if offset is not None else timedelta(0)


def _events_for_day(
    seed: str, label: str, zone: ZoneInfo, day: date, count: int
) -> list[dict[str, object]]:
    """Events spread across a local day, however many hours that day happens to have.

    The first and last minute are always occupied. A wrong offset misplaces an event by
    moving it across a *day boundary*, not by moving it across the switch itself, so
    leaving those two positions to chance would make a checkpoint's verdict depend on
    which seed the participant happened to draw.

    The offsets are measured in UTC on purpose. Adding a `timedelta` to an aware
    datetime is wall-clock arithmetic, so on a 25-hour day `midnight + span` would run
    past the end of the day and land on the next one — the exact confusion this problem
    is about.
    """
    start = _local_midnight(zone, day).astimezone(timezone.utc)
    end = _local_midnight(zone, day + timedelta(days=1)).astimezone(timezone.utc)
    span = int((end - start).total_seconds())
    rng = _rng(seed, f"{label}:{day.isoformat()}")
    offsets = [30, span - 30]
    offsets.extend(rng.randrange(0, span) for _ in range(max(count - len(offsets), 0)))
    events = []
    for index, offset in enumerate(offsets):
        moment = start + timedelta(seconds=offset)
        events.append(
            {
                "id": f"{label}-{day.isoformat()}-{index:03d}",
                "at": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "amount": rng.randrange(1, 500),
            }
        )
    return events


def _expected(
    events: list[dict[str, object]], zone: ZoneInfo, first: date, last: date
) -> dict[str, int]:
    days: dict[str, int] = {}
    cursor = first
    while cursor <= last:
        days[cursor.isoformat()] = 0
        cursor += timedelta(days=1)
    for event in events:
        moment = datetime.strptime(str(event["at"]), "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
        key = moment.astimezone(zone).date().isoformat()
        if key in days:
            days[key] += int(event["amount"])
    return days


def _call(module: ModuleType, *args: object) -> object:
    try:
        return module.daily_totals(*args)
    except Exception as error:  # noqa: BLE001 - participant exceptions are a failed property
        return {"raised": type(error).__name__}


def _days_of(result: object) -> dict[str, int] | None:
    if not isinstance(result, dict) or result.get("ok") is not True:
        return None
    days = result.get("days")
    if not isinstance(days, dict):
        return None
    if any(not isinstance(k, str) or not isinstance(v, int) for k, v in days.items()):
        return None
    return days


def _compare(
    module: ModuleType,
    events: list[dict[str, object]],
    zone_name: str,
    first: date,
    last: date,
    what: str,
) -> list[str]:
    zone = ZoneInfo(zone_name)
    expected = _expected(events, zone, first, last)
    actual = _days_of(_call(module, events, zone_name, first.isoformat(), last.isoformat()))
    if actual is None:
        return [f"{what} did not return a usable day map"]
    failures: list[str] = []
    if set(actual) != set(expected):
        failures.append(f"{what} did not report exactly one entry per day in the range")
        return failures
    for day, total in expected.items():
        if actual[day] != total:
            failures.append(
                # §15: the actual total is the submission's own output; the expected total
                # and which specific day it is would hand the checkpoint its answer, so
                # neither leaves this message.
                f"{what}: one of the days totalled {actual[day]}, which is not its true sum"
            )
            break
    if sum(actual.values()) != sum(expected.values()):
        failures.append(f"{what} lost or duplicated value across the range")
    return failures


def _ordinary_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """An ordinary week, away from any transition."""
    failures: list[str] = []
    zone_name, transition = pick_zone_and_day(seed, f"{phase}:zone")
    zone = ZoneInfo(zone_name)
    first = transition + timedelta(days=40)
    last = first + timedelta(days=4)

    events: list[dict[str, object]] = []
    cursor = first
    while cursor <= last:
        events.extend(_events_for_day(seed, f"{phase}:ordinary", zone, cursor, 6))
        cursor += timedelta(days=1)
    failures.extend(_compare(module, events, zone_name, first, last, "an ordinary week"))

    empty = _days_of(_call(module, [], zone_name, first.isoformat(), last.isoformat()))
    if empty is None or set(empty) != {
        (first + timedelta(days=index)).isoformat() for index in range((last - first).days + 1)
    }:
        failures.append("a range with no events did not still report every day")
    elif any(value != 0 for value in empty.values()):
        failures.append("a day with no events was not reported as 0")

    # The first code checkpoint already includes one real transition, because a
    # checkpoint the shipped starter passes would hand out points for the defect the
    # problem is about.
    first_transition = transition - timedelta(days=1)
    last_transition = transition + timedelta(days=1)
    across: list[dict[str, object]] = []
    cursor = first_transition
    while cursor <= last_transition:
        across.extend(_events_for_day(seed, f"{phase}:across", zone, cursor, 12))
        cursor += timedelta(days=1)
    failures.extend(
        _compare(module, across, zone_name, first_transition, last_transition, "a transition day")
    )

    # Events outside the requested range are not this report's business: they must not
    # be counted, and they must not add a day the caller did not ask for.
    outside = [
        *_events_for_day(seed, f"{phase}:before", zone, first - timedelta(days=2), 4),
        *_events_for_day(seed, f"{phase}:after", zone, last + timedelta(days=2), 4),
    ]
    failures.extend(
        _compare(module, [*events, *outside], zone_name, first, last, "a range with outside events")
    )

    for bad_args, expected_error in (
        (([], "Not/AZone", first.isoformat(), last.isoformat()), "invalid_timezone"),
        (
            (
                [{"id": "a", "at": "2026-01-01T00:00:00", "amount": 1}],
                zone_name,
                first.isoformat(),
                last.isoformat(),
            ),
            "invalid_events",
        ),
        (([], zone_name, "2026-13-01", last.isoformat()), "invalid_range"),
        (([], zone_name, last.isoformat(), first.isoformat()), "invalid_range"),
        (([{"id": "a", "at": "nope", "amount": 1}], zone_name, first.isoformat(), last.isoformat()), "invalid_events"),
        (([{"id": "a", "at": "2026-01-01T00:00:00Z"}], zone_name, first.isoformat(), last.isoformat()), "invalid_events"),
    ):
        result = _call(module, *bad_args)
        if result != {"ok": False, "error": expected_error}:
            failures.append(f"invalid input did not return {expected_error}")
    return failures


def _transition_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """The two days a year when the local day is not twenty-four hours long."""
    failures = _ordinary_properties(module, seed, phase)
    zone_name, transition = pick_zone_and_day(seed, f"{phase}:zone")
    zone = ZoneInfo(zone_name)

    first = transition - timedelta(days=1)
    last = transition + timedelta(days=1)

    # The clock moves at the switch, but nothing changes day there: an event at 02:30
    # local is on the transition day under any reading. These probes say so explicitly,
    # so a submission cannot earn the checkpoint by special-casing the switch hour.
    switch = _local_midnight(zone, transition)
    probes: list[dict[str, object]] = []
    for index, minutes in enumerate((-90, -30, -1, 1, 30, 90, 150, 210)):
        moment = (switch + timedelta(hours=2, minutes=minutes)).astimezone(timezone.utc)
        probes.append(
            {
                "id": f"probe-{index:02d}",
                "at": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "amount": 100 + index,
            }
        )
    failures.extend(_compare(module, probes, zone_name, first, last, "the hours around the switch"))

    # Where it does change day is midnight, which belongs to the day that starts there.
    # Both ends of all three days are probed: a stale offset pushes an event over the
    # boundary at the *end* of the shortened day when the clocks go back and over the
    # boundary at the *start* of the following day when they go forward, so checking
    # only one of them would catch only one of the two switches.
    boundary: list[dict[str, object]] = []
    for index, day in enumerate((transition - timedelta(days=1), transition, transition + timedelta(days=1))):
        boundary.append(
            {
                "id": f"boundary-{index:02d}-start",
                "at": _local_midnight(zone, day)
                .astimezone(timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
                "amount": 7 + index,
            }
        )
        boundary.append(
            {
                "id": f"boundary-{index:02d}-end",
                # One second before the next local midnight, stepped back in UTC so the
                # answer does not depend on wall-clock arithmetic either.
                "at": (
                    _local_midnight(zone, day + timedelta(days=1)).astimezone(timezone.utc)
                    - timedelta(seconds=1)
                ).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "amount": 11 + index,
            }
        )
    failures.extend(_compare(module, boundary, zone_name, first, last, "the day boundary"))
    return failures


def _sweep_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """Both transitions, several zones, and a range that spans one.

    This is what the transition checkpoint promises — "a 23-hour day and a 25-hour
    day, for either direction of switch" — and the one seed-chosen transition of
    `_transition_properties` only ever exercises one direction. An implementation
    tuned to the switch it saw fails here on the day the clocks move the other way.
    """
    failures: list[str] = []
    rng = _rng(seed, f"{phase}:zones")
    for zone_name in rng.sample(ZONES, 3):
        zone = ZoneInfo(zone_name)
        for year_offset in (0, 1):
            for transition in transitions(zone_name, 2026 + year_offset):
                first = transition - timedelta(days=1)
                last = transition + timedelta(days=1)
                events: list[dict[str, object]] = []
                cursor = first
                while cursor <= last:
                    events.extend(
                        _events_for_day(seed, f"{phase}:{zone_name}", zone, cursor, 12)
                    )
                    cursor += timedelta(days=1)
                found = _compare(
                    module, events, zone_name, first, last, f"{zone_name} on {transition}"
                )
                if found:
                    # One zone and transition is enough to explain the gap.
                    return failures + found

    # A range that covers a whole season, so both a 23-hour and a 25-hour day sit
    # inside one call and the totals must still add up.
    zone_name = ZONES[_rng(seed, f"{phase}:span").randrange(len(ZONES))]
    zone = ZoneInfo(zone_name)
    year_transitions = transitions(zone_name, 2026)
    first = min(year_transitions) - timedelta(days=1)
    last = max(year_transitions) + timedelta(days=1)
    events = []
    for transition in year_transitions:
        for delta in (-1, 0, 1):
            events.extend(
                _events_for_day(
                    seed, f"{phase}:span", zone, transition + timedelta(days=delta), 8
                )
            )
    failures.extend(_compare(module, events, zone_name, first, last, "a range spanning both switches"))
    return failures


def _full_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """Everything `daily_totals` has to satisfy: the transition probes plus the sweep."""
    return _transition_properties(module, seed, phase) + _sweep_properties(module, seed, phase)


# --- the counterexample checkpoint --------------------------------------------------

Counterexample = Callable[[str, str, str], object]

#: The two pairs the statement itself works through. They come first so the first
#: failure a participant reads is about numbers they have already seen.
STATEMENT_CASES: tuple[tuple[str, date, date], ...] = (
    ("America/New_York", date(2026, 10, 31), date(2026, 11, 1)),
    ("America/New_York", date(2026, 3, 7), date(2026, 3, 8)),
)
#: Zones every counterexample run includes on top of the seed-sampled ``ZONES``. Both
#: keep a local midnight on every day, so the statement's definition of a day holds.
#:
#: - Lord Howe Island moves its clocks by thirty minutes (02:00 local, like the others).
#:   The window the fixed offset misfiles is then half an hour wide, so a construction
#:   that hard-codes a whole-hour window (23:30 when the start's offset is the bigger
#:   one, 00:30 when it is the smaller) stays inside the day it meant to leave in the
#:   "smaller" direction: 00:30 read thirty minutes early is 00:00 of the same day. The
#:   boundary seconds the statement names (23:59:59 / 00:00:00) cross for any width.
#: - Nuuk switches at the day boundary itself (23:00 → 00:00 in spring, 24:00 → 23:00 in
#:   autumn), so the switch and the boundary hour coincide. Its midnights still exist and
#:   are unambiguous, unlike zones whose spring switch is 00:00 → 01:00.
COUNTEREXAMPLE_EXTRA_ZONES: tuple[str, ...] = ("Australia/Lord_Howe", "America/Nuuk")
#: The contract's own limit on a range, in days.
MAX_RANGE_DAYS = 400


def _start_with_the_new_offset(zone: ZoneInfo, switch: date, rng: random.Random) -> date | None:
    """A range start, months before the switch, whose midnight already carries the
    offset the switch moves *to*.

    From such a start the days after the switch are not misplaced at all — the
    misplaced ones lie between the start and the switch, on the other side of the
    boundary hour. A rule keyed on the switch's direction alone puts the event on the
    wrong side there; the rule the statement gives (compare the start's offset with
    the day's own) does not.
    """
    after = _midnight_offset(zone, switch + timedelta(days=1))
    candidates = [
        switch - timedelta(days=distance)
        for distance in range(60, MAX_RANGE_DAYS - 9)
        if _midnight_offset(zone, switch - timedelta(days=distance)) == after
    ]
    return candidates[rng.randrange(len(candidates))] if candidates else None


def counterexample_cases(seed: str) -> list[tuple[str, date, date]]:
    """(zone, start_day, switch_day) triples: several zones, both directions of switch,
    and for each switch a start on the day itself, a start a few days earlier, and a
    start months earlier that already carries the new offset.

    The seed-sampled zones come first, then the two zones every run includes, so the
    first failure a participant reads is about a whole-hour switch whenever one fails.
    """
    cases = list(STATEMENT_CASES)
    rng = _rng(seed, "counterexample:cases")
    for zone_name in (*rng.sample(ZONES, 3), *COUNTEREXAMPLE_EXTRA_ZONES):
        zone = ZoneInfo(zone_name)
        for year in (2026, 2027):
            for switch in transitions(zone_name, year):
                cases.append((zone_name, switch, switch))
                cases.append((zone_name, switch - timedelta(days=rng.randrange(1, 30)), switch))
                far = _start_with_the_new_offset(zone, switch, rng)
                if far is not None:
                    cases.append((zone_name, far, switch))
    return cases


def _parse_instant(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment.astimezone(timezone.utc) if moment.tzinfo is not None else None


def _parse_day(value: object) -> date | None:
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_event(value: object) -> tuple[datetime, int] | None:
    """One event in the `daily_totals` shape, or None when the contract rejects it."""
    if not isinstance(value, dict) or set(value) != {"id", "at", "amount"}:
        return None
    if not isinstance(value["id"], str) or not value["id"]:
        return None
    moment = _parse_instant(value["at"])
    amount = value["amount"]
    if moment is None or type(amount) is not int or not 0 <= amount <= 1_000_000:
        return None
    return moment, amount


def _rollup(
    parsed: list[tuple[datetime, int]],
    zone: ZoneInfo,
    first: date,
    last: date,
    fixed_offset: timedelta | None,
) -> dict[str, int]:
    """Per-day totals. With `fixed_offset` this is the starter's broken arithmetic
    (one offset added to every instant); without it, the calendar's."""
    days: dict[str, int] = {}
    cursor = first
    while cursor <= last:
        days[cursor.isoformat()] = 0
        cursor += timedelta(days=1)
    for moment, amount in parsed:
        if fixed_offset is None:
            key = moment.astimezone(zone).date().isoformat()
        else:
            key = (moment + fixed_offset).date().isoformat()
        if key in days:
            days[key] += amount
    return days


def _counterexample_failures(
    build: Counterexample, zone_name: str, start: date, switch: date
) -> list[str]:
    """Property failures for one (zone, start_day, switch_day) triple.

    Every message names a documented rule of the checkpoint and echoes only the public
    parameters the submission was called with (AGENTS.md §15).
    """
    where = f"{zone_name}, range from {start.isoformat()} with the switch on {switch.isoformat()}"
    try:
        result = build(zone_name, start.isoformat(), switch.isoformat())
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return [f"{where}: counterexample() raised {type(error).__name__}"]
    if not isinstance(result, dict) or set(result) != {"end_day", "events"}:
        return [f"{where}: counterexample() did not return a dict with exactly end_day and events"]
    end = _parse_day(result["end_day"])
    if end is None or end < switch or (end - start).days > MAX_RANGE_DAYS:
        return [
            f"{where}: end_day must be a YYYY-MM-DD date on or after the switch day, "
            f"at most {MAX_RANGE_DAYS} days after start_day"
        ]
    events = result["events"]
    if not isinstance(events, list) or len(events) != 1:
        return [f"{where}: the counterexample must contain exactly one event"]
    parsed = _parse_event(events[0])
    if parsed is None or parsed[1] < 1:
        return [
            f"{where}: the event does not follow the daily_totals event shape "
            "(id, at carrying an offset, amount 1 or more)"
        ]
    zone = ZoneInfo(zone_name)
    truth = _rollup([parsed], zone, start, end, None)
    fixed = _rollup([parsed], zone, start, end, _midnight_offset(zone, start))
    short = [day for day, total in truth.items() if fixed[day] < total]
    if not short:
        # The range's ends are the submission's own arguments and its own end_day, so
        # naming them narrows nothing (§15); the rule that the short day must lie inside
        # the range is stated next to the end_day rule in the statement.
        return [
            f"{where}: under the fixed-offset rollup no day inside the range "
            f"{start.isoformat()}..{end.isoformat()} comes up short"
        ]
    if all(_is_switch_day(zone, date.fromisoformat(day)) for day in short):
        return [
            f"{where}: the only day that comes up short under the fixed-offset rollup "
            "is a switch day; an ordinary day must"
        ]
    return []


def check_counterexample(module: ModuleType, seed: str) -> list[str]:
    """Failures for the counterexample checkpoint. Empty means it passes."""
    build = getattr(module, "counterexample", None)
    if not callable(build):
        return ["submission does not define counterexample()"]
    failures: list[str] = []
    for zone_name, start, switch in counterexample_cases(seed):
        failures.extend(_counterexample_failures(build, zone_name, start, switch))
        if len(failures) >= 3:
            # Three triples are enough to explain the gap; the rest would only repeat.
            break
    return failures


def check_rollup(module: ModuleType, seed: str) -> list[str]:
    return _ordinary_properties(module, seed, "rollup-checkpoint")


def check_transition(module: ModuleType, seed: str) -> list[str]:
    return _full_properties(module, seed, "transition-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _full_properties(module, seed, "full-run")
