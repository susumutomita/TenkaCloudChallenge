"""Seed-derived evidence for the range-boundary report lab.

Everything a participant is shown hangs off one seeded day, ``run_date``. The
shipped report, the ledger it was built from and the pass phrase all move with
``FLAG_SEED``, so the graded answers belong to *this* deployment and cannot be
copied from a writeup.

Nothing here computes the correct total. That sum is the answer to the ``observe``
checkpoint, so it lives in the hidden verifier image and not in this file, which
ships inside the participant image.
"""

from __future__ import annotations

import hashlib
import random
from datetime import date, timedelta

# The contract the whole problem is about: "the last WINDOW_DAYS days" means the
# WINDOW_DAYS whole days *before* the run date. The run date itself is not over yet.
WINDOW_DAYS = 7

# The ledger shows more days than the window so the window has to be located rather
# than assumed to be "every row I was given".
LEDGER_DAYS_BEFORE = 9
LEDGER_DAYS_AFTER = 1

_EPOCH = date(2026, 1, 1)


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _token(seed: str, label: str, width: int = 10) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode()).hexdigest()[:width]


def health_token(seed: str) -> str:
    return f"range-lab-{_token(seed, 'health', 12)}"


def run_date(seed: str) -> date:
    """The morning this deployment's report was produced."""
    return _EPOCH + timedelta(days=_rng(seed, "run-date").randrange(400, 900))


def daily_ledger(seed: str) -> list[dict[str, object]]:
    """One row per calendar day, in the shape ``report_total`` consumes.

    The row count is per day and always positive, so a window that is one day too
    wide always reports a different number from a window that is exactly right.
    """
    run = run_date(seed)
    rng = _rng(seed, "ledger")
    rows: list[dict[str, object]] = []
    for offset in range(-LEDGER_DAYS_BEFORE, LEDGER_DAYS_AFTER + 1):
        day = run + timedelta(days=offset)
        rows.append({"date": day.isoformat(), "count": rng.randrange(12, 400)})
    return rows


def shipped_report(seed: str) -> dict[str, object]:
    """The daily report as it was actually sent, defect included.

    Its printed range is inclusive at both ends, so it spans WINDOW_DAYS + 1 days.
    The participant is shown the printed range and the reported total; which day is
    one too many, and what the total should have been, is the audit.
    """
    run = run_date(seed)
    counts = {row["date"]: int(row["count"]) for row in daily_ledger(seed)}
    printed_start = run - timedelta(days=WINDOW_DAYS)
    printed = [printed_start + timedelta(days=index) for index in range(WINDOW_DAYS + 1)]
    return {
        "reportId": f"weekly-{_token(seed, 'report', 6)}",
        "runDate": run.isoformat(),
        "windowLabel": "直近 7 日 / last 7 days",
        "printedRange": f"{printed_start.isoformat()} 〜 {run.isoformat()}",
        "reportedTotal": sum(counts[day.isoformat()] for day in printed),
        "i18n": {"en": {"windowLabel": "last 7 days"}},
    }


# Every question the participant is asked, in one place because both the CLI
# (`show.py`) and the Portal (`workbench/server.py`) render them. Japanese is the
# default and English lives under `i18n.en`, the same convention metadata.json uses.
QUESTIONS = {
    "observe": {
        "question": (
            "このレポートは「直近 7 日」を名乗っています。 契約では、直近 7 日とは runDate を"
            " 含まない、その直前の 7 日間です。 レポートの合計に入っているのに、その 7 日間には"
            " 属さない日はどれですか。 また、その日を除いた正しい合計はいくつですか。"
        ),
        "answerFormat": '["<YYYY-MM-DD>", <正しい合計 (整数)>]',
        "i18n": {
            "en": {
                "question": (
                    "This report calls itself \"the last 7 days\". By the contract that means the"
                    " seven whole days before runDate, with runDate itself excluded. Which day is"
                    " in the reported total but not in those seven days, and what is the total"
                    " once that day is left out?"
                ),
                "answerFormat": '["<YYYY-MM-DD>", <correct total as an integer>]',
            }
        },
    },
}
