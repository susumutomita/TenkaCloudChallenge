"""Author-only mutant that converts for display but groups in UTC.

This is the most attractive wrong answer. It uses zoneinfo, it never touches a fixed
offset, and the day labels are genuine local dates — so it looks like the textbook
fix. It is still wrong, because the grouping key is derived from the UTC date and
only then relabelled, which silently shifts every event near either end of the day.
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
        # Grouped by the UTC day, then relabelled through the zone. The label is a
        # real local date; the bucket it names is not.
        utc_day = moment.date()
        label = datetime(
            utc_day.year, utc_day.month, utc_day.day, 12, tzinfo=timezone.utc
        ).astimezone(zone).date().isoformat()
        if label in days:
            days[label] += amount

    return {"ok": True, "days": days}
