"""A deliberately incomplete aggregation.

The public contract is ``summarize(rows)``. It returns
``{"ok": True, "total": str, "shares": {id: str}}`` on success and
``{"ok": False, "error": str}`` for invalid input.

On the sample data this produces the right total and shares that look right, and every
public test agrees. What it does not yet promise is that the answer is the same when
the same rows arrive in a different order, or that the shares add back up.
"""

from __future__ import annotations


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


def _parse_rows(value: object) -> list[tuple[str, str]] | None:
    if not isinstance(value, list) or not value or len(value) > 5_000:
        return None
    parsed: list[tuple[str, str]] = []
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
            value_as_number = float(amount)
        except ValueError:
            return None
        if value_as_number < 0 or round(value_as_number, 2) != value_as_number:
            return None
        parsed.append((identifier, amount))
    return parsed


def summarize(rows: object) -> dict[str, object]:
    """Total the line items and report each one's share of that total.

    ``rows`` is a list of ``{"id": str, "amount": str}`` where every amount is a
    non-negative decimal string with at most two decimal places. The returned
    ``total`` is the exact sum and does not depend on the order of ``rows``. Every
    share is that row's own percentage of the total rounded to the cent, and the
    shares add up to exactly ``"100.00"``.

    TODO: the total is neither order-independent nor exact, and the shares do not add
    back up.
    """
    parsed = _parse_rows(rows)
    if parsed is None:
        return _error("invalid_rows")

    total = 0.0
    for _, amount in parsed:
        total += float(amount)

    shares = {}
    for identifier, amount in parsed:
        share = (float(amount) / total * 100) if total else 0.0
        shares[identifier] = f"{share:.2f}"

    return {"ok": True, "total": f"{total:.2f}", "shares": shares}
