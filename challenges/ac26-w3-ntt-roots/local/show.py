"""`make inspect` — the fields this deployment draws from, and one worked transform.

    make inspect

This prints orientation material only: which primes the hidden phases draw from, which
orders are legal in each, and a single worked evaluation so the shape of the answer is
concrete. It does not print which parameters the starter's rule gets wrong, and nothing
it imports can decide that -- see `fixtures/generate.py`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import PRIMES, health_token, lab_fields, worked_example

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

    example = worked_example()
    prime, order, omega = example["prime"], example["order"], example["omega"]
    coefficients = example["coefficients"]
    assert isinstance(coefficients, list)
    points, values = example["points"], example["values"]
    assert isinstance(points, list) and isinstance(values, list)

    print(f"A worked transform, the same on every deployment: p = {prime}, n = {order}")
    print(f"  f(x)           : {coefficients} (constant term first)")
    print(f"  omega          : {omega}")
    print("   i |  omega^i | f(omega^i)")
    for index, (point, value) in enumerate(zip(points, values, strict=True)):
        print(f"   {index} | {point:8d} | {value:10d}")
    print()
    print(f"  the {order} points are distinct, which is what makes this invertible.")
    print()
    print("The hidden phases use primes and orders that are not in the public tests.")
    print("Whether the omega your code picks is the right one for those is the problem.")


if __name__ == "__main__":
    main()
