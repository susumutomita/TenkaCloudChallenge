"""Seeded orientation material for the roots-of-unity lab (stdlib only).

What a learner needs before writing code is the shape of the problem: which fields the
transform is defined over, which orders are legal in each of them, and what "evaluate at
the powers of omega" produces concretely.

What is deliberately *not* here is any way to decide whether a given element has the
order it is supposed to have. That decision is the problem. The worked example below is
a fixed triple with omega written out as a constant rather than derived, so nothing in
the participant image computes a primitive root.
"""

from __future__ import annotations

import hashlib

#: The fields the transform is defined over. Toy sizes: small enough to check a claim by
#: hand, large enough that the orders dividing p-1 are varied rather than all powers of
#: two. The hidden phases draw from this family and from orders the public tests never use.
PRIMES = (13, 17, 29, 41, 73, 97, 113, 193, 257, 337, 641, 769, 1009, 1153, 3457, 7681)

#: The largest order the contract accepts in this lab's parameter range.
MAX_ORDER = 128


def health_token(seed: str) -> str:
    """A per-deploy string, so a printed transcript can be tied to one deployment.

    No checkpoint scores it; this problem is graded entirely on submitted code.
    """
    return f"ntt-roots-{hashlib.sha256(seed.encode()).hexdigest()[:12]}"


def orders_for(prime: int) -> list[int]:
    """Every order the contract accepts over `prime`: the divisors of p-1, ascending.

    An order is legal exactly when it divides p-1, because that is when the multiplicative
    group has a subgroup of that size at all. Which elements sit in it is a separate
    question, and not one this module answers.
    """
    return [d for d in range(1, min(prime - 1, MAX_ORDER) + 1) if (prime - 1) % d == 0]


def lab_fields(seed: str, count: int = 4) -> list[dict[str, object]]:
    """A seed-derived sample of the family, with the legal orders in each field.

    Orientation only: knowing which orders are legal is the definition, not the answer.
    Nothing here says which of them the textbook rule gets wrong.
    """
    digest = hashlib.sha256(f"{seed}:fields".encode()).digest()
    picked, seen = [], set()
    for index in range(len(PRIMES)):
        prime = PRIMES[(digest[index % len(digest)] + index) % len(PRIMES)]
        if prime in seen:
            continue
        seen.add(prime)
        picked.append({"prime": prime, "legalOrders": orders_for(prime)})
        if len(picked) == count:
            break
    return picked


def evaluate(coefficients: list[int], point: int, prime: int) -> int:
    """f(point) mod prime, by Horner. The mechanics of the transform, not its hard part."""
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


#: One worked example, identical on every deploy. `omega` is a written-out constant, not
#: something this module derives -- deriving it would put a working
#: `primitive_root_of_unity` inside the participant image, which is the answer.
#:
#: (p=17, n=4, omega=13) is one of the pairs the public tests already use, so it reveals
#: nothing the learner cannot read off `tests/public/test_ntt.py`.
WORKED_EXAMPLE = {
    "prime": 17,
    "order": 4,
    "omega": 13,
    "coefficients": [1, 2, 3, 4],
}


def worked_example() -> dict[str, object]:
    """The example expanded: the evaluation points, and the value at each of them."""
    prime = int(WORKED_EXAMPLE["prime"])
    order = int(WORKED_EXAMPLE["order"])
    omega = int(WORKED_EXAMPLE["omega"])
    coefficients = list(WORKED_EXAMPLE["coefficients"])  # type: ignore[arg-type]
    points = [pow(omega, i, prime) for i in range(order)]
    return {
        **WORKED_EXAMPLE,
        "points": points,
        "values": [evaluate(coefficients, point, prime) for point in points],
    }
