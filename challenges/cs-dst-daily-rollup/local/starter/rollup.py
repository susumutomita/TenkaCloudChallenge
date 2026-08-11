"""A deliberately incomplete daily rollup.

The public contract is ``daily_totals(events, timezone_name, start_day, end_day)``.
It returns ``{"ok": True, "days": {"YYYY-MM-DD": int}}`` on success and
``{"ok": False, "error": str}`` for invalid input.

On ordinary weeks this produces the right number for every day, and every public test
agrees. What it does not yet promise is anything about the two days a year when a
local day is not twenty-four hours long.
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
