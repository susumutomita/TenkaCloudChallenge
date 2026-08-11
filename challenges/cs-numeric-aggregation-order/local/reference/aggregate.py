"""Reference solution: an exact total and an allocation that adds back up."""

from __future__ import annotations

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
        # Amounts arrive as decimal strings on purpose: turning them into float here is
        # the very first place the exact value is lost, before any addition happens.
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
    """Split 100% across the rows so the parts add back to exactly 100.00.

    Rounding each share on its own leaves a remainder that has to land somewhere.
    Dropping it is what makes a report show 99.99%, so the leftover cents are handed
    out by largest fractional part, deterministically broken by row order.
    """
    if total == 0:
        shares = {identifier: Decimal("0.00") for identifier, _ in rows}
        if rows:
            shares[rows[0][0]] = HUNDRED.quantize(PERCENT)
        return {identifier: f"{value}" for identifier, value in shares.items()}

    exact_shares = [(identifier, amount / total * HUNDRED) for identifier, amount in rows]
    floored = [(identifier, value.quantize(PERCENT, rounding="ROUND_DOWN")) for identifier, value in exact_shares]
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
    """Total the line items and report each one's share of that total.

    ``rows`` is a list of ``{"id": str, "amount": str}`` where every amount is a
    non-negative decimal string with at most two decimal places. The returned
    ``total`` is the exact sum, and ``shares`` maps each id to its percentage of the
    total with two decimal places. Both are decimal strings.

    The total does not depend on the order of ``rows``. Every share is that row's own
    percentage of the total rounded to the cent, and the shares add up to exactly
    ``"100.00"`` whenever there is at least one row.
    """
    parsed = _parse_rows(rows)
    if parsed is None:
        return _error("invalid_rows")

    total = sum((amount for _, amount in parsed), Decimal("0.00")).quantize(CENTS)
    return {"ok": True, "total": f"{total}", "shares": _allocate(parsed, total)}
