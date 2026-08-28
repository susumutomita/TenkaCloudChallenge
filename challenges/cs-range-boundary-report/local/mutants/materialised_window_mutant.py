"""Author-only mutant that builds the window as a set of dates, one day too large.

This is the most attractive wrong answer. It does not compare two ends at all, so it
cannot be caught by "did they write `<` instead of `<=`?" — it enumerates the days it
intends to count, which reads like the careful version. It also reports the correct
``start`` and ``end``, so the window it *claims* is right.

It passes the entire public suite: the first day of the window is counted, the day
before it is not, the day after the report is not, repeats and order behave, every
documented error is returned. The one day it gets wrong is the run date, because
``range(days + 1)`` walks one fence post too many — the same off-by-one as counting
"the 5th through the 12th" and calling it seven days.
"""

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
    if type(days) is not int or days < 1 or days > MAX_WINDOW_DAYS:
        return _error("invalid_days")
    end = _parse_day(today)
    if end is None:
        return _error("invalid_today")
    parsed = _parse_rows(rows)
    if parsed is None:
        return _error("invalid_rows")

    start = end - timedelta(days=days)
    window = {start + timedelta(days=offset) for offset in range(days + 1)}

    total = 0
    counted = 0
    for day, count in parsed:
        if day in window:
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
