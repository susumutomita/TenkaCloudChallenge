"""Reference solution: total exactly the days the contract names, and no others."""

from __future__ import annotations

from datetime import date, timedelta

WINDOW_DAYS = 7
MAX_WINDOW_DAYS = 3660


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


def _parse_day(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _parse_rows(rows: object) -> list[tuple[date, int]] | None:
    """Copy the caller's rows into (day, count) pairs, or reject the whole input.

    Reading into a new list is also what keeps the caller's own list and dicts
    untouched: a report must not rearrange the ledger it was handed.
    """
    if not isinstance(rows, (list, tuple)):
        return None
    parsed: list[tuple[date, int]] = []
    for row in rows:
        if not isinstance(row, dict):
            return None
        day = _parse_day(row.get("date"))
        count = row.get("count")
        if day is None or type(count) is not int:
            return None
        parsed.append((day, count))
    return parsed


def report_total(rows: object, today: object, days: object = WINDOW_DAYS) -> dict[str, object]:
    """Total the rows that fall in the ``days`` whole days before ``today``.

    The window is half-open: it begins on ``start`` and stops *before* ``end``.
    ``end`` is ``today`` itself, which is therefore never counted — the day the
    report runs is not over yet, so it is not one of the days being reported on.
    """
    if type(days) is not int or days < 1 or days > MAX_WINDOW_DAYS:
        return _error("invalid_days")
    end = _parse_day(today)
    if end is None:
        return _error("invalid_today")
    parsed = _parse_rows(rows)
    if parsed is None:
        return _error("invalid_rows")

    # The length of the window is measured from its exclusive end, so the first day
    # counted is `days` days back and the last day counted is the day before `end`.
    start = end - timedelta(days=days)

    total = 0
    counted = 0
    for day, count in parsed:
        # `start` is inside the window and `end` is outside it. Writing both ends the
        # same way is what makes the window one day too wide or one day too short.
        if start <= day < end:
            total += count
            counted += 1

    return {
        "ok": True,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": days,
        "total": total,
        "rows": counted,
    }
