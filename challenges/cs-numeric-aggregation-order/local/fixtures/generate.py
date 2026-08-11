"""Seed-derived evidence for the aggregation lab."""

from __future__ import annotations

import hashlib
import random
from decimal import Decimal


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _token(seed: str, label: str, width: int = 10) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode()).hexdigest()[:width]


def health_token(seed: str) -> str:
    return f"aggregate-lab-{_token(seed, 'health', 12)}"


def disputed_report(seed: str) -> dict[str, object]:
    rng = _rng(seed, "report")
    return {
        "reportId": f"rpt-{_token(seed, 'report-id', 8)}",
        "period": f"2026-{rng.randrange(1, 12):02d}",
        "lineItems": rng.randrange(180, 900),
    }


def reconciliation_runs(seed: str) -> list[dict[str, object]]:
    """The same line items totalled several times, in different orders.

    Only what each run reported is recorded: the order it read the rows in and the
    figure it printed. Nothing here says which runs are wrong — that is the audit.
    """
    report = disputed_report(seed)
    rng = _rng(seed, "runs")
    base = Decimal(rng.randrange(10**13, 10**15)) / 100
    drift = Decimal("0.01")
    agreed = f"{base}"
    disagreed = f"{base + drift}"

    # How many runs agree before and after the odd ones moves with the seed, so the
    # answer is a position in *this* deployment's log rather than a fixed pair.
    leading = rng.randrange(2, 5)
    trailing = rng.randrange(2, 5)
    orders = ["as-entered", "by-amount-descending", "by-amount-ascending", "by-id", "as-received"]

    rows: list[dict[str, object]] = []
    for index in range(leading):
        rows.append(
            {
                "run": f"run-{len(rows) + 1:02d}",
                "rowOrder": orders[index % len(orders)],
                "reportedTotal": agreed,
                "rowCount": report["lineItems"],
            }
        )
    for index in range(2):
        rows.append(
            {
                "run": f"run-{len(rows) + 1:02d}",
                "rowOrder": orders[(leading + index) % len(orders)],
                "reportedTotal": disagreed,
                "rowCount": report["lineItems"],
            }
        )
    for index in range(trailing):
        rows.append(
            {
                "run": f"run-{len(rows) + 1:02d}",
                "rowOrder": orders[(leading + 2 + index) % len(orders)],
                "reportedTotal": agreed,
                "rowCount": report["lineItems"],
            }
        )
    return rows


def allocation_sheet(seed: str) -> list[dict[str, str]]:
    """A published allocation whose parts do not add up to the whole."""
    rng = _rng(seed, "allocation")
    shares = []
    remaining = Decimal("100.00")
    for index in range(6):
        value = (Decimal(rng.randrange(800, 2200)) / 100).quantize(Decimal("0.01"))
        shares.append({"department": f"dept-{_token(seed, f'dept-{index}', 4)}", "share": f"{value}"})
        remaining -= value
    shares.append(
        {
            "department": f"dept-{_token(seed, 'dept-last', 4)}",
            # One cent short on purpose: this is what dropping the remainder looks like.
            "share": f"{(remaining - Decimal('0.01')).quantize(Decimal('0.01'))}",
        }
    )
    return shares
