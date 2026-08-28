"""A daily-report total that is asked for seven days and does not deliver seven days.

The public contract is ``report_total(rows, today, days=7)``.

``rows`` is a list of ``{"date": "YYYY-MM-DD", "count": <int>}`` — one row per event
or per already-aggregated day, in any order, with repeats allowed. ``today`` is the
day the report runs, either a ``datetime.date`` or an ISO ``"YYYY-MM-DD"`` string.

The window is the ``days`` **whole days before** ``today``. ``today`` itself is not
counted: the day the report runs is not over yet, so it is not one of the days being
reported on. In the returned dictionary ``start`` is the first day that *is* counted
and ``end`` is the first day that is *not* — the window is ``[start, end)``.

On success::

    {"ok": True, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD",
     "days": <int>, "total": <int>, "rows": <int>}

``total`` is the sum of ``count`` over the rows inside the window and ``rows`` is how
many rows that was. On bad input the call returns ``{"ok": False, "error": <name>}``
with ``invalid_days``, ``invalid_today`` or ``invalid_rows``.

Every public test passes today. None of them puts a row on the one day where this
implementation and the contract above disagree.

TODO: count exactly the days the contract names, and keep the same rule when ``days``
is something other than 7.
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
    """Copy the caller's rows into (day, count) pairs, or reject the whole input."""
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
    """Total the rows that fall in the reporting window ending at ``today``."""
    if type(days) is not int or days < 1 or days > MAX_WINDOW_DAYS:
        return _error("invalid_days")
    end = _parse_day(today)
    if end is None:
        return _error("invalid_today")
    parsed = _parse_rows(rows)
    if parsed is None:
        return _error("invalid_rows")

    start = end - timedelta(days=WINDOW_DAYS)

    total = 0
    counted = 0
    for day, count in parsed:
        if start <= day <= end:
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
