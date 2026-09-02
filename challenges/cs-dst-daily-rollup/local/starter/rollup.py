"""A deliberately incomplete daily rollup.

Two functions are graded from this file.

``daily_totals(events, timezone_name, start_day, end_day)`` is the public contract.
It returns ``{"ok": True, "days": {"YYYY-MM-DD": int}}`` on success and
``{"ok": False, "error": str}`` for invalid input. On ordinary weeks this produces the
right number for every day, and every public test agrees. What it does not yet
promise is anything about the two days a year when a local day is not twenty-four
hours long -- nor about the days after them.

``counterexample(timezone_name, start_day, switch_day)`` (the last checkpoint) builds
one event that shows the broken way of totalling getting an ordinary day wrong.
``fixed_offset_day`` between the two is a helper for checking it; it is not graded.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


def _parse_instant(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else None


def _parse_day(value: object) -> date | None:
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_events(value: object) -> list[tuple[datetime, int]] | None:
    if not isinstance(value, list) or len(value) > 20_000:
        return None
    parsed: list[tuple[datetime, int]] = []
    seen: set[str] = set()
    for row in value:
        if not isinstance(row, dict) or set(row) != {"id", "at", "amount"}:
            return None
        identifier = row["id"]
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            return None
        seen.add(identifier)
        moment = _parse_instant(row["at"])
        if moment is None:
            return None
        amount = row["amount"]
        if type(amount) is not int or not 0 <= amount <= 1_000_000:
            return None
        parsed.append((moment.astimezone(timezone.utc), amount))
    return parsed


def daily_totals(
    events: object, timezone_name: object, start_day: object, end_day: object
) -> dict[str, object]:
    """Total ``events`` per local calendar day between ``start_day`` and ``end_day``.

    Each event is ``{"id": str, "at": str, "amount": int}`` where ``at`` is an
    instant with an offset. ``timezone_name`` is an IANA zone; the days are that
    zone's calendar days, inclusive of both ends. The result has one entry for every
    day in the range, ``0`` where nothing happened, and an event belongs to the day
    it happened on in that zone.

    TODO: the day an event belongs to is computed from a fixed offset, as though every
    local day were exactly twenty-four hours long.
    """
    parsed = _parse_events(events)
    if parsed is None:
        return _error("invalid_events")
    if not isinstance(timezone_name, str) or not timezone_name:
        return _error("invalid_timezone")
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return _error("invalid_timezone")
    first = _parse_day(start_day)
    last = _parse_day(end_day)
    if first is None or last is None or last < first:
        return _error("invalid_range")
    if (last - first).days > 400:
        return _error("invalid_range")

    days: dict[str, int] = {}
    cursor = first
    while cursor <= last:
        days[cursor.isoformat()] = 0
        cursor += timedelta(days=1)

    # One offset is read for the whole range and then applied to every instant.
    reference_offset = datetime.combine(first, datetime.min.time(), tzinfo=zone).utcoffset()
    offset_seconds = int(reference_offset.total_seconds()) if reference_offset else 0

    for moment, amount in parsed:
        shifted = moment + timedelta(seconds=offset_seconds)
        local_day = shifted.date().isoformat()
        if local_day in days:
            days[local_day] += amount

    return {"ok": True, "days": days}


def fixed_offset_day(at: str, timezone_name: str, start_day: str) -> str:
    """The day the *fixed-offset* rollup files an event under -- the broken way.

    This is the same arithmetic ``daily_totals`` uses before you fix it: the offset is
    read once, at ``start_day``'s midnight in ``timezone_name``, and added to the
    instant. It is kept here on purpose, so that you can compare it with the calendar's
    answer while building your counterexample. It is not graded.

    Example (New York; the range starts on 2026-10-31, so the offset read is -4 hours):
    ``fixed_offset_day("2026-11-03T04:59:59Z", "America/New_York", "2026-10-31")``
    returns ``"2026-11-03"``, whereas the calendar says that instant is 23:59:59 on
    2026-11-02 in New York.
    """
    moment = _parse_instant(at)
    if moment is None:
        raise ValueError("at must be an instant carrying an offset, like 2026-11-03T04:30:00Z")
    zone = ZoneInfo(timezone_name)
    first = date.fromisoformat(start_day)
    offset = datetime.combine(first, datetime.min.time(), tzinfo=zone).utcoffset()
    shifted = moment.astimezone(timezone.utc) + (offset or timedelta(0))
    return shifted.date().isoformat()


def counterexample(timezone_name: str, start_day: str, switch_day: str) -> dict[str, object]:
    """One event that the fixed-offset rollup files under the wrong day -- and the day
    it takes the amount away from is NOT a switch day.

    Given (all three are strings):
      - ``timezone_name``: an IANA zone, e.g. ``"America/New_York"``.
      - ``start_day``: the first day of the range, ``"YYYY-MM-DD"``. It is the switch
        day itself or earlier -- sometimes months earlier.
      - ``switch_day``: a day in that zone that is not 24 hours long (23 or 25 hours
        in New York), ``"YYYY-MM-DD"``.

    Return ``{"end_day": "YYYY-MM-DD", "events": [<exactly one event>]}``:
      - The range runs from ``start_day`` to ``end_day`` inclusive. It contains
        ``switch_day`` and is at most 400 days long. The day that comes up short must
        lie inside this range too: ``daily_totals`` only reports days in the range, so
        a day outside it cannot come up short. If the day you break is after
        ``switch_day``, make ``end_day`` that day or later.
      - The event has the ``daily_totals`` shape ``{"id": str, "at": str, "amount": int}``
        with ``amount`` 1 or more and ``at`` carrying an offset (``...Z`` is fine).

    What the answer has to satisfy (graded as a property, never against one expected
    value): totalling that one event the fixed-offset way -- the offset read at
    ``start_day``'s midnight added to every instant, exactly what ``fixed_offset_day``
    does -- leaves some day inside the range that is NOT a switch day short of its
    true total. A short switch day does not count: that is the statement's own
    example, and this function is about ordinary days.

    The rule is in the statement: the fixed offset misfiles an event only on a day
    whose offset differs from the start's. The misfiled window is as wide as the
    difference between the two offsets -- one hour in New York, but not one hour in
    every zone. When the start's offset is the bigger one, the day's LAST second
    (23:59:59) moves to the next day whatever the width; when it is the smaller one,
    the day's FIRST second (00:00:00) moves to the day before. A time merely near the
    boundary (23:30, say) does not move where the difference is smaller than that.

    In Python:
      - a date from a string like ``"2026-10-31"``: ``d = date.fromisoformat(start_day)``;
        then ``d.year``, ``d.month`` and ``d.day`` are its parts, and
        ``d + timedelta(days=1)`` is the next day.
      - the offset in force on a day:
        ``datetime(d.year, d.month, d.day, tzinfo=zone).utcoffset()`` gives a value
        like ``timedelta(hours=-5)``. Two of these compare with ``<`` and ``>``.
      - a day is a switch day when the offset at its midnight differs from the offset
        at the next day's midnight.
      - a wall-clock time in the zone: ``datetime(2026, 11, 2, 23, 59, 59, tzinfo=zone)``;
        the same instant in UTC: ``.astimezone(timezone.utc)``; as the ``at`` string:
        ``.strftime("%Y-%m-%dT%H:%M:%SZ")`` gives ``"2026-11-03T04:59:59Z"``.

    Worked example: New York, start_day 2026-10-31, switch_day 2026-11-01. The offset
    read at the start is -4 hours. On 2026-11-02, an ordinary 24-hour day, the offset
    is -5 hours -- the start's offset is the bigger one, so the fixed-offset rollup
    reads every instant of that day one hour LATE: the day's last second, 23:59:59
    local (04:59:59Z on the 3rd), is filed under the 3rd, and the 2nd comes up short.
    So ``{"end_day": "2026-11-02", "events": [{"id": "e1", "at": "2026-11-03T04:59:59Z",
    "amount": 1}]}`` is one valid answer.

    The graded run tries several zones (including one whose switch is not a whole
    hour), both directions of switch and several start days -- including start days
    months before the switch -- within a 15-second limit. The version below is a
    placeholder: it returns no event at all.
    """
    return {"end_day": switch_day, "events": []}
