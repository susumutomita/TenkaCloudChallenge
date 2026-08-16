"""`make inspect` — the fields this deployment draws from, and two example domains.

    make inspect

This prints orientation material only: which primes the hidden phases draw from, which
orders are legal in each, one domain that is real, and one that only looks real. It does
not print how to tell the two apart in general, and nothing it imports can decide that
-- see `fixtures/generate.py`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import PRIMES, broken_domain, health_token, lab_fields, worked_domain

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    print("deployment       :", health_token(SEED))
    print("field family     :", ", ".join(str(prime) for prime in PRIMES))
    print()
    print("An order n is legal over p exactly when n divides p-1. A sample of this")
    print("deployment's family, with the orders the contract accepts in each:")
    print()
    for field in lab_fields(SEED):
        orders = field["legalOrders"]
        assert isinstance(orders, list)
        rendered = ", ".join(str(order) for order in orders)
        print(f"  p = {field['prime']:<5} legal orders: {rendered}")
    print()

    real = worked_domain()
    coefficients = real["coefficients"]
    points, values = real["points"], real["values"]
    assert isinstance(coefficients, list)
    assert isinstance(points, list) and isinstance(values, list)
    print(f"A real domain, the same on every deployment: p = {real['prime']}, n = {real['order']}, omega = {real['omega']}")
    print(f"  f(x)           : {coefficients} (constant term first)")
    print("   i |  omega^i | f(omega^i)")
    for index, (point, value) in enumerate(zip(points, values, strict=True)):
        print(f"   {index} | {point:8d} | {value:10d}")
    print(f"  the {real['order']} points are distinct, which is what makes this invertible.")
    print()

    fake = broken_domain()
    fake_points = fake["points"]
    assert isinstance(fake_points, list)
    print(f"A domain that only looks real: p = {fake['prime']}, n = {fake['order']}, omega = {fake['omega']}")
    print(f"  omega ** n mod p = {fake['omegaToTheN']}  (the one equation everyone checks: it holds)")
    print(f"  its powers       : {fake_points}")
    print("  the points repeat, so nothing evaluated on them can be inverted.")
    print()
    print("The hidden phases hand your code omegas of both kinds, over primes and orders")
    print("the public tests never use. Deciding which kind you were handed is the problem.")


if __name__ == "__main__":
    main()
