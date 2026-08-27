"""Seeded orientation material for the FFT-domain lab (stdlib only).

What a learner needs before writing code is the shape of the problem: which fields the
transforms run over, which orders are legal in each, what an evaluation domain looks
like when it is real, and what it looks like when it silently is not.

What is deliberately *not* here is any way to decide whether a handed omega has the
order it claims. That decision is the problem. Both examples below are fixed constants
with their powers written out, so nothing in the participant image computes an order.
"""

from __future__ import annotations

import hashlib

#: The fields the lab draws from. Toy sizes: small enough to check a claim by hand,
#: large enough that the orders dividing p-1 are varied rather than all powers of two.
PRIMES = (13, 17, 29, 41, 73, 97, 113, 193, 257, 337, 641, 769, 1009, 1153, 3457, 7681)

#: The largest order the contract accepts in this lab's parameter range.
MAX_ORDER = 128


def health_token(seed: str) -> str:
    """A per-deploy string, so a printed transcript can be tied to one deployment.

    No checkpoint scores it; this problem is graded entirely on submitted code.
    """
    return f"fft-domain-{hashlib.sha256(seed.encode()).hexdigest()[:12]}"


def orders_for(prime: int) -> list[int]:
    """Every order the contract accepts over `prime`: the divisors of p-1, ascending.

    Divisibility is necessary because the multiplicative group only has a subgroup of
    size n when n divides p-1. It is not sufficient: which elements generate that
    subgroup is a separate question, and not one this module answers.
    """
    return [d for d in range(1, min(prime - 1, MAX_ORDER) + 1) if (prime - 1) % d == 0]


def lab_fields(seed: str, count: int = 4) -> list[dict[str, object]]:
    """A seed-derived sample of the family, with the legal orders in each field."""
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
    """f(point) mod prime, by Horner. The mechanics of evaluation, not its hard part."""
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


#: A real evaluation domain, identical on every deploy. omega is a written-out
#: constant, not something this module derives. (p=17, n=4, omega=13) is a pair the
#: public tests already use, so it reveals nothing the learner cannot read off
#: `tests/public/test_fftdomain.py`.
WORKED_DOMAIN = {
    "prime": 17,
    "order": 4,
    "omega": 13,
    "coefficients": [1, 2, 3, 4],
}

#: A domain that only looks real, also fixed. Its omega satisfies the one equation
#: everyone checks -- omega ** n == 1 -- and its powers still repeat, because the
#: *order* of this omega is smaller than n. The repetition is printed rather than
#: asserted; deciding it in general is the participant's code, not this module.
BROKEN_DOMAIN = {
    "prime": 97,
    "order": 8,
    "omega": 75,
}


def worked_domain() -> dict[str, object]:
    """The real domain expanded: distinct points, and the value at each of them."""
    prime = int(WORKED_DOMAIN["prime"])
    order = int(WORKED_DOMAIN["order"])
    omega = int(WORKED_DOMAIN["omega"])
    coefficients = list(WORKED_DOMAIN["coefficients"])  # type: ignore[arg-type]
    points = [pow(omega, i, prime) for i in range(order)]
    return {
        **WORKED_DOMAIN,
        "points": points,
        "values": [evaluate(coefficients, point, prime) for point in points],
    }


def broken_domain() -> dict[str, object]:
    """The fake domain expanded: omega ** n == 1 holds, and the points repeat."""
    prime = int(BROKEN_DOMAIN["prime"])
    order = int(BROKEN_DOMAIN["order"])
    omega = int(BROKEN_DOMAIN["omega"])
    return {
        **BROKEN_DOMAIN,
        "omegaToTheN": pow(omega, order, prime),
        "points": [pow(omega, i, prime) for i in range(order)],
    }


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Carries values, not code.

    This is exactly what `make inspect` has always printed and nothing more: the field
    family, this deployment's sample of it with the orders that divide p-1 in each, the
    one worked domain that is real, and the one that only looks real. Both example
    domains are fixed constants on every deploy, so neither narrows a graded run.

    What does not travel is the decision procedure. Divisibility -- `orders_for` -- is
    the necessary half and was always printed; deciding whether a handed omega has the
    order it claims is the problem, and the module that answers it
    (`tests/hidden/check_fftdomain.py`, whose `has_order` is that decision written from
    the definition, next to `real_omega` and `naive_omega`) stays in the verifier image.
    """
    return {
        "healthToken": health_token(seed),
        "primes": list(PRIMES),
        "maxOrder": MAX_ORDER,
        "labFields": lab_fields(seed),
        "workedDomain": worked_domain(),
        "brokenDomain": broken_domain(),
    }
