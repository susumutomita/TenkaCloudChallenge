"""Author-only mutant that removes the order dependence but not the error.

This is the most attractive wrong answer. It reaches for ``math.fsum``, so the total
no longer depends on row order and matches the exact figure on every ordinary input.
It is still wrong, because the precision was lost when each decimal string became a
float — before any addition happened. Summing those floats perfectly cannot recover
what parsing already threw away.
"""

from __future__ import annotations

import math
from decimal import Decimal, InvalidOperation

CENTS = Decimal("0.01")
PERCENT = Decimal("0.01")
HUNDRED = Decimal("100")


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


def _parse_rows(value: object) -> list[tuple[str, Decimal]] | None:
    if not isinstance(value, list) or not value or len(value) > 5_000:
        return None
    parsed: list[tuple[str, Decimal]] = []
    seen: set[str] = set()
    for row in value:
        if not isinstance(row, dict) or set(row) != {"id", "amount"}:
            return None
        identifier = row["id"]
        amount = row["amount"]
        if not isinstance(identifier, str) or not identifier or len(identifier) > 64:
            return None
        if identifier in seen:
            return None
        seen.add(identifier)
        if not isinstance(amount, str) or not amount:
            return None
        try:
            exact = Decimal(amount)
        except InvalidOperation:
            return None
        if exact != exact.quantize(CENTS) or exact < 0:
            return None
        parsed.append((identifier, exact))
    return parsed


def _allocate(rows: list[tuple[str, Decimal]], total: Decimal) -> dict[str, str]:
    if total == 0:
        shares = {identifier: Decimal("0.00") for identifier, _ in rows}
        if rows:
            shares[rows[0][0]] = HUNDRED.quantize(PERCENT)
        return {identifier: f"{value}" for identifier, value in shares.items()}
    exact_shares = [(identifier, amount / total * HUNDRED) for identifier, amount in rows]
    floored = [
        (identifier, value.quantize(PERCENT, rounding="ROUND_DOWN"))
        for identifier, value in exact_shares
    ]
    assigned = sum((value for _, value in floored), Decimal("0.00"))
    remaining = int(((HUNDRED - assigned) / PERCENT).to_integral_value())
    order = sorted(
        range(len(rows)),
        key=lambda index: (-(exact_shares[index][1] - floored[index][1]), index),
    )
    result = dict(floored)
    for position in range(remaining):
        identifier = rows[order[position % len(order)]][0]
        result[identifier] = result[identifier] + PERCENT
    return {identifier: f"{result[identifier]}" for identifier, _ in rows}


def summarize(rows: object) -> dict[str, object]:
    parsed = _parse_rows(rows)
    if parsed is None:
        return _error("invalid_rows")
    # Order-independent, and still not the exact figure.
    total = Decimal(f"{math.fsum(float(amount) for _, amount in parsed):.2f}")
    return {"ok": True, "total": f"{total}", "shares": _allocate(parsed, total)}
