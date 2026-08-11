"""Seed-derived evidence for the daily-rollup lab."""

from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Zones whose switch happens away from midnight, so a local midnight always exists.
ZONES = (
    "America/New_York",
    "Europe/Berlin",
    "Australia/Sydney",
    "Pacific/Auckland",
    "America/Denver",
    "Europe/London",
)


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _token(seed: str, label: str, width: int = 10) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode()).hexdigest()[:width]


def health_token(seed: str) -> str:
    return f"rollup-lab-{_token(seed, 'health', 12)}"


def _transitions(zone_name: str, year: int) -> list[date]:
    """Local dates in `year` that are not twenty-four hours long."""
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


def reported_zone(seed: str) -> dict[str, object]:
    """The deployment's zone and the day its report disagreed with the ledger."""
    rng = _rng(seed, "zone")
    zone_name = ZONES[rng.randrange(len(ZONES))]
    year = 2026 + rng.randrange(0, 3)
    days = _transitions(zone_name, year)
    day = days[rng.randrange(len(days))]
    zone = ZoneInfo(zone_name)
    start = datetime(day.year, day.month, day.day, tzinfo=zone)
    end = datetime(day.year, day.month, day.day, tzinfo=zone) + timedelta(days=1)
    hours = int((end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() // 3600)
    return {
        "reportId": f"rpt-{_token(seed, 'report', 8)}",
        "timezone": zone_name,
        "disputedDay": day.isoformat(),
        "localHoursThatDay": hours,
    }


def daily_report(seed: str) -> list[dict[str, object]]:
    """The published daily report next to the ledger's own count for each day.

    Only the two numbers per day are recorded. Nothing here says which days are wrong
    or why — that is the audit.
    """
    info = reported_zone(seed)
    day = date.fromisoformat(str(info["disputedDay"]))
    rng = _rng(seed, "report-rows")
    before = rng.randrange(2, 5)
    after = rng.randrange(2, 5)

    rows: list[dict[str, object]] = []
    for index in range(before, 0, -1):
        total = rng.randrange(400, 900)
        rows.append(
            {
                "day": (day - timedelta(days=index)).isoformat(),
                "reportedTotal": total,
                "ledgerTotal": total,
            }
        )
    # The switch moves events across the boundary: one day gains what the other lost.
    moved = rng.randrange(30, 120)
    neighbour_total = rng.randrange(400, 900)
    day_total = rng.randrange(400, 900)
    rows.append(
        {
            "day": (day - timedelta(days=0)).isoformat(),
            "reportedTotal": day_total - moved,
            "ledgerTotal": day_total,
        }
    )
    rows.append(
        {
            "day": (day + timedelta(days=1)).isoformat(),
            "reportedTotal": neighbour_total + moved,
            "ledgerTotal": neighbour_total,
        }
    )
    for index in range(2, after + 2):
        total = rng.randrange(400, 900)
        rows.append(
            {
                "day": (day + timedelta(days=index)).isoformat(),
                "reportedTotal": total,
                "ledgerTotal": total,
            }
        )
    return rows
