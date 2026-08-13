"""Hidden property checks for the three code checkpoints.

The claim is about two days a year. Nothing here is sampled or timed: the checker
builds its own expectation with the same calendar the contract names, and every zone
and date is derived from the verifier seed, so a submission cannot special-case the
week it saw in the public tests.

The transitions used are real ones from the system tz database. Only zones whose
switch happens away from midnight are used, so a local midnight always exists — the
lesson here is that a day can be 23 or 25 hours long, not that a wall-clock time can
fail to exist at all.
"""

from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta, timezone
from types import ModuleType
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
        following = cursor + timedelta(days=1)
        start = datetime(cursor.year, cursor.month, cursor.day, tzinfo=zone)
        end = datetime(following.year, following.month, following.day, tzinfo=zone)
        if (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)) != timedelta(hours=24):
            found.append(cursor)
        cursor = following
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
                f"{what}: {day} totalled {actual[day]} instead of {total}"
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


def _generalize_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """Both transitions, several zones, and a range that spans one."""
    failures = _transition_properties(module, seed, phase)

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


def check_rollup(module: ModuleType, seed: str) -> list[str]:
    return _ordinary_properties(module, seed, "rollup-checkpoint")


def check_transition(module: ModuleType, seed: str) -> list[str]:
    return _transition_properties(module, seed, "transition-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "full-run")
