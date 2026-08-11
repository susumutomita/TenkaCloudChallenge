"""Reference solution: daily totals in a real calendar, not in 86400-second blocks."""

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
    instant with an offset (``...Z`` or ``+09:00``). ``timezone_name`` is an IANA
    zone; the days are that zone's calendar days, inclusive of both ends.

    The result is ``{"ok": True, "days": {"YYYY-MM-DD": int}}`` with one entry for
    every day in the range, ``0`` where nothing happened. An event belongs to the
    day it happened on in that zone — which is not the same as its instant divided
    into 86400-second blocks, because a local day is not always 24 hours long.
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

    for moment, amount in parsed:
        # The whole point: ask the calendar which day this instant fell on, rather
        # than computing a day number from the instant itself.
        local_day = moment.astimezone(zone).date().isoformat()
        if local_day in days:
            days[local_day] += amount

    return {"ok": True, "days": days}
