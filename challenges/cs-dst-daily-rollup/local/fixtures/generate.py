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


def disputed_index(seed: str) -> int:
    """Row number of the switch day, the first day whose published total disagrees.

    The rows after it are deliberately not derived here: the stale offset keeps
    misplacing the boundary hour on every later day, and finding that is the audit.
    """
    day = str(reported_zone(seed)["disputedDay"])
    for index, row in enumerate(daily_report(seed)):
        if row["day"] == day:
            return index
    raise AssertionError("the report must contain the disputed day")


def daily_report(seed: str) -> list[dict[str, object]]:
    """The published daily report next to the ledger's own count for each day.

    The report is what a rollup that reads one offset at the start of its range and
    adds it to every instant publishes for a range that starts before the switch.
    Every day from the switch onward is therefore off by the amount that fell inside
    the one hour the stale offset carries across a day boundary:

      - when the clocks went back the stale offset reads every later instant an hour
        late, so each day from the switch day on loses its last hour to the next day,
        and the last day's share leaves the range and is counted nowhere;
      - when the clocks went forward it reads them an hour early, so each day after
        the switch loses its first hour to the day before, and the switch day itself
        only gains.

    Consecutive moved amounts always differ, so a day never happens to gain exactly
    what it lost. Only the two numbers per day are recorded. Nothing here says which
    days are wrong or why — that is the audit.
    """
    info = reported_zone(seed)
    day = date.fromisoformat(str(info["disputedDay"]))
    clocks_went_back = int(str(info["localHoursThatDay"])) == 25
    rng = _rng(seed, "report-rows")
    before = rng.randrange(2, 5)
    after = rng.randrange(2, 5)
    last = after + 1

    ledger = {index: rng.randrange(400, 900) for index in range(-before, last + 1)}
    moved: dict[int, int] = {}
    previous: int | None = None
    for index in range(0, last + 1):
        value = rng.randrange(30, 120)
        while value == previous:
            value = rng.randrange(30, 120)
        moved[index] = value
        previous = value

    rows: list[dict[str, object]] = []
    for index in range(-before, last + 1):
        total = ledger[index]
        if index < 0:
            reported = total
        elif clocks_went_back:
            reported = total - moved[index] + (moved[index - 1] if index >= 1 else 0)
        else:
            reported = (
                total
                - (moved[index] if index >= 1 else 0)
                + (moved[index + 1] if index + 1 <= last else 0)
            )
        rows.append(
            {
                "day": (day + timedelta(days=index)).isoformat(),
                "reportedTotal": reported,
                "ledgerTotal": total,
            }
        )
    return rows


# Participant-visible evidence, built in one place so `make inspect` and the Portal
# cannot drift apart. Japanese is the default and English lives under `i18n.en`, the
# same convention metadata.json and the Workbench config use.
COLUMN_GLOSSARY = {
    "index": "audit で答えるときの行番号。",
    "day": "レポートが集計対象とした現地の暦日。",
    "reportedTotal": "日次ジョブが公開した値。 疑われているのはこちら。",
    "ledgerTotal": "台帳自身が数えた値。 こちらが正しいものとして扱う。",
}

COLUMN_GLOSSARY_EN = {
    "index": "Row number, which is what the audit checkpoint is answered with.",
    "day": "The local calendar day the report totalled.",
    "reportedTotal": "What the daily job published. This is the number in question.",
    "ledgerTotal": "What the ledger itself counted. Treat this one as correct.",
}


def evidence(seed: str) -> dict[str, object]:
    """Everything a participant may see. Contains no expected answer."""
    rows = daily_report(seed)
    zone = reported_zone(seed)
    disputed = disputed_index(seed)
    # Through the disputed day inclusive. The rows after it are held back because the
    # discrepancy carries on past that day, and noticing that is the audit.
    window = [{"index": index, **row} for index, row in enumerate(rows[: disputed + 1])]
    return {
        "environment": {
            "healthToken": health_token(seed),
            "question": "この合言葉をそのまま貼り、lab が起動していることを示してください。",
            "i18n": {
                "en": {
                    "question": "Paste this pass phrase as-is to show the lab is running."
                }
            },
        },
        "observe": {
            "report": {
                "reportId": zone["reportId"],
                "timezone": zone["timezone"],
                "disputedDay": zone["disputedDay"],
            },
            "columns": COLUMN_GLOSSARY,
            "rows": window,
            "question": (
                f"集計コードも台帳も変わっていません。 それでも {zone['disputedDay']} だけ "
                f"reportedTotal が ledgerTotal と合いません。 "
                f"{zone['timezone']} の暦で、この日は他の日と何が違いますか。"
            ),
            "answerFormat": (
                '["<reportId>", "<not-24-hours | missing-rows | double-counted | clock-skew '
                'のいずれか 1 つ>"]'
            ),
            "i18n": {
                "en": {
                    "columns": COLUMN_GLOSSARY_EN,
                    "question": (
                        f"Neither the totalling code nor the ledger changed, yet on "
                        f"{zone['disputedDay']} alone the reportedTotal does not match the "
                        f"ledgerTotal. In the {zone['timezone']} calendar, what is different "
                        f"about that day?"
                    ),
                    "answerFormat": (
                        '["<reportId>", "<one of: not-24-hours | missing-rows | '
                        'double-counted | clock-skew>"]'
                    ),
                }
            },
        },
        "audit": {
            "timezone": zone["timezone"],
            "columns": COLUMN_GLOSSARY,
            "rows": [{"index": index, **row} for index, row in enumerate(rows)],
            "question": (
                "報告値が正しくあり得ない日を、1 つ残らず挙げてください。 "
                "ある日が失った分は、消えたのではありません。"
            ),
            "answerFormat": "[<index>, ...] (index の昇順、重複なし)",
            "i18n": {
                "en": {
                    "columns": COLUMN_GLOSSARY_EN,
                    "question": (
                        "List every day whose reported total cannot be right. The amount one "
                        "day lost did not vanish."
                    ),
                    "answerFormat": "[<index>, ...] (ascending, no duplicates)",
                }
            },
        },
    }
