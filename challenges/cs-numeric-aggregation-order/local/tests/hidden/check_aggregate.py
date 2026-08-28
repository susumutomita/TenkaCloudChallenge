"""Hidden property checks for the three code checkpoints.

The claim is about answers that look right. Every property here compares the
submission against decimal arithmetic done independently in the checker, and every
input is derived from the verifier seed, so a submission cannot special-case the
figures it saw in the public tests.

Two wrong answers are deliberately separated. Accumulating in ``float`` is both
order-dependent and inexact. ``math.fsum`` (or sorting first) removes the order
dependence but is still inexact, because the loss happens when the decimal string
becomes a float, before any addition. Only exact arithmetic passes.
"""

from __future__ import annotations

import hashlib
import random
from decimal import Decimal
from types import ModuleType

CENTS = Decimal("0.01")
HUNDRED = Decimal("100")


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _rows(seed: str, label: str, count: int, magnitude: int = 4) -> list[dict[str, str]]:
    rng = _rng(seed, label)
    rows = []
    for index in range(count):
        cents = rng.randrange(1, 10 ** magnitude)
        rows.append({"id": f"row-{index:03d}", "amount": f"{Decimal(cents) / 100}"})
    return rows


def _wide_rows(seed: str, label: str, count: int = 48) -> list[dict[str, str]]:
    """Amounts spread across many orders of magnitude.

    This is where a float loses: adding a cent to a number near 1e14 cannot change
    it, so the answer depends on which order the additions happen in.
    """
    rng = _rng(seed, label)
    rows = [{"id": "row-anchor", "amount": f"{Decimal(rng.randrange(10**15, 10**17)) / 100}"}]
    for index in range(count):
        cents = rng.randrange(1, 40)
        rows.append({"id": f"row-{index:03d}", "amount": f"{Decimal(cents) / 100}"})
    return rows


def _exact_total(rows: list[dict[str, str]]) -> Decimal:
    return sum((Decimal(row["amount"]) for row in rows), Decimal("0.00")).quantize(CENTS)


def _call(module: ModuleType, rows: object) -> object:
    try:
        return module.summarize(rows)
    except Exception as error:  # noqa: BLE001 - participant exceptions are a failed property
        return {"raised": type(error).__name__}


def _total_of(result: object) -> Decimal | None:
    if not isinstance(result, dict) or result.get("ok") is not True:
        return None
    total = result.get("total")
    if not isinstance(total, str):
        return None
    try:
        return Decimal(total)
    except Exception:  # noqa: BLE001 - an unparsable total is a failed property
        return None


def _shares_of(result: object) -> dict[str, Decimal] | None:
    if not isinstance(result, dict):
        return None
    shares = result.get("shares")
    if not isinstance(shares, dict):
        return None
    parsed: dict[str, Decimal] = {}
    for key, value in shares.items():
        if not isinstance(key, str) or not isinstance(value, str):
            return None
        try:
            parsed[key] = Decimal(value)
        except Exception:  # noqa: BLE001 - an unparsable share is a failed property
            return None
    return parsed


def _total_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures: list[str] = []

    ordinary = _rows(seed, f"{phase}:ordinary", 40)
    result = _call(module, ordinary)
    total = _total_of(result)
    if total is None:
        failures.append("an ordinary aggregation did not return a usable total")
    elif total != _exact_total(ordinary):
        failures.append("the total of ordinary rows was not the exact sum")

    # The lesson: the same set in a different order is the same set.
    wide = _wide_rows(seed, f"{phase}:wide")
    forward = _total_of(_call(module, list(wide)))
    backward = _total_of(_call(module, list(reversed(wide))))
    shuffled = list(wide)
    _rng(seed, f"{phase}:shuffle").shuffle(shuffled)
    mixed = _total_of(_call(module, shuffled))
    if forward is None or backward is None or mixed is None:
        failures.append("aggregating rows that span many magnitudes did not return a total")
    else:
        if not (forward == backward == mixed):
            failures.append("the same rows in a different order produced a different total")
        expected = _exact_total(wide)
        if forward != expected:
            failures.append("the total of rows spanning many magnitudes was not exact")

    # Reducing the error is not the same as removing it: this set is chosen so that a
    # correctly-rounded float sum still lands on the wrong cent, because the loss
    # already happened when each decimal string became a float.
    for attempt in range(6):
        candidate = _rows(seed, f"{phase}:exactness-{attempt}", 58, magnitude=15)
        exact = _exact_total(candidate)
        import math

        float_sum = Decimal(f"{math.fsum(float(row['amount']) for row in candidate):.2f}")
        if float_sum != exact:
            reported = _total_of(_call(module, candidate))
            if reported is None:
                failures.append("a large-magnitude aggregation did not return a total")
            elif reported != exact:
                failures.append(
                    "the total was rounded rather than exact for large amounts"
                )
            break

    empty = _call(module, [])
    if empty != {"ok": False, "error": "invalid_rows"}:
        failures.append("an empty row list did not return the documented error")
    bad = _call(module, [{"id": "a", "amount": "1.234"}])
    if bad != {"ok": False, "error": "invalid_rows"}:
        failures.append("an amount with more than two decimals was accepted")
    return failures


def _allocation_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _total_properties(module, seed, phase)

    for label, rows in (
        ("ordinary", _rows(seed, f"{phase}:alloc", 37)),
        ("wide", _wide_rows(seed, f"{phase}:alloc-wide", count=29)),
        ("thirds", [{"id": f"row-{index}", "amount": "1.00"} for index in range(3)]),
        ("sevenths", [{"id": f"row-{index}", "amount": "1.00"} for index in range(7)]),
    ):
        result = _call(module, rows)
        shares = _shares_of(result)
        if shares is None:
            failures.append(f"the {label} aggregation did not return usable shares")
            continue
        if set(shares) != {row["id"] for row in rows}:
            failures.append(f"the {label} aggregation did not report one share per row")
            continue
        assigned = sum(shares.values(), Decimal("0.00"))
        # A report whose parts do not add to the whole is the visible symptom; the
        # leftover cents have to be handed out, not dropped.
        if assigned != HUNDRED:
            failures.append(f"the {label} shares added up to {assigned}, not 100.00")
        if any(value != value.quantize(CENTS) for value in shares.values()):
            failures.append(f"a {label} share was not reported to the cent")
        if any(value < 0 for value in shares.values()):
            failures.append(f"a {label} share was negative")
        # Adding up to 100.00 is necessary but not sufficient: the leftover cents have
        # to go to the rows that earned them. Handing them all to one row still totals
        # 100.00 while putting that row cents away from its real percentage.
        total = _exact_total(rows)
        if total > 0:
            for row in rows:
                exact_share = Decimal(row["amount"]) / total * HUNDRED
                if abs(shares[row["id"]] - exact_share) > CENTS:
                    failures.append(
                        f"a {label} share was more than a cent from the row's real percentage"
                    )
                    break

    # Shares must follow the amounts: a bigger row cannot get a smaller share.
    rows = _rows(seed, f"{phase}:monotonic", 24)
    shares = _shares_of(_call(module, rows))
    if shares is not None and len(shares) == len(rows):
        by_amount = sorted(rows, key=lambda row: Decimal(row["amount"]))
        for smaller, larger in zip(by_amount, by_amount[1:], strict=False):
            if Decimal(smaller["amount"]) < Decimal(larger["amount"]):
                if shares[smaller["id"]] > shares[larger["id"]]:
                    failures.append("a smaller row was allocated a larger share")
                    break
    return failures


def _generalize_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _allocation_properties(module, seed, phase)

    single = [{"id": "only", "amount": "42.00"}]
    result = _call(module, single)
    shares = _shares_of(result)
    if _total_of(result) != Decimal("42.00"):
        failures.append("a single row did not total to its own amount")
    if shares != {"only": Decimal("100.00")}:
        failures.append("a single row was not allocated the whole 100.00")

    # Every amount can legitimately be zero; the report still has to add up.
    zeros = [{"id": f"row-{index}", "amount": "0.00"} for index in range(5)]
    result = _call(module, zeros)
    shares = _shares_of(result)
    if _total_of(result) != Decimal("0.00"):
        failures.append("an all-zero aggregation did not total to 0.00")
    if shares is None or sum(shares.values(), Decimal("0.00")) != HUNDRED:
        failures.append("an all-zero aggregation did not still allocate 100.00")

    # A long tail of tiny rows under one large one is the shape that made the
    # original report wrong; it must hold at size.
    many = _wide_rows(seed, f"{phase}:many", count=400)
    result = _call(module, many)
    if _total_of(result) != _exact_total(many):
        failures.append("a large aggregation lost cents")
    shares = _shares_of(result)
    if shares is None or sum(shares.values(), Decimal("0.00")) != HUNDRED:
        failures.append("a large aggregation did not allocate exactly 100.00")

    for invalid in (
        "not-a-list",
        [{"id": "a", "amount": 1.5}],
        [{"id": "a", "amount": "-1.00"}],
        [{"id": "a", "amount": "1.00"}, {"id": "a", "amount": "2.00"}],
        [{"id": "a"}],
    ):
        if _call(module, invalid) != {"ok": False, "error": "invalid_rows"}:
            # §15: the invalid probes are hidden test data; naming them would invite
            # rejecting exactly these values instead of validating the input shape.
            failures.append("invalid input was accepted")
    return failures


def check_total(module: ModuleType, seed: str) -> list[str]:
    return _total_properties(module, seed, "total-checkpoint")


def check_allocate(module: ModuleType, seed: str) -> list[str]:
    return _allocation_properties(module, seed, "allocate-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "full-run")
