"""Reference solution: a domain is only a domain if omega really has order n."""

from __future__ import annotations

MAX_PRIME = 1_000_003
MAX_LENGTH = 4096


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


def _is_prime(value: int) -> bool:
    if value < 2:
        return False
    if value % 2 == 0:
        return value == 2
    factor = 3
    while factor * factor <= value:
        if value % factor == 0:
            return False
        factor += 2
    return True


def _prime_factors(value: int) -> set[int]:
    factors: set[int] = set()
    remaining, candidate = value, 2
    while candidate * candidate <= remaining:
        while remaining % candidate == 0:
            factors.add(candidate)
            remaining //= candidate
        candidate += 1
    if remaining > 1:
        factors.add(remaining)
    return factors


def has_order(candidate: int, order: int, prime: int) -> bool:
    """True when `candidate` has multiplicative order exactly `order` in F_prime.

    Both halves are needed. ``candidate ** order == 1`` on its own is satisfied by
    every element of every *smaller* subgroup, 1 included. Only ``!= 1`` at each
    maximal proper divisor pins the order to exactly `order`.
    """
    if candidate % prime == 0:
        return False
    if pow(candidate, order, prime) != 1:
        return False
    return all(pow(candidate, order // q, prime) != 1 for q in _prime_factors(order))


def _parse_prime(prime: object) -> str | None:
    if type(prime) is not int or prime < 3 or prime > MAX_PRIME or not _is_prime(prime):
        return "invalid_prime"
    return None


def _parse_list(value: object, prime: int) -> list[int] | None:
    if not isinstance(value, list) or not value or len(value) > MAX_LENGTH:
        return None
    for item in value:
        if type(item) is not int or not 0 <= item < prime:
            return None
    return list(value)


def _domain_ok(omega: object, order: int, prime: int) -> bool:
    """The whole question in one place: n divides p-1 and omega has order exactly n."""
    if (prime - 1) % order != 0:
        return False
    return type(omega) is int and has_order(omega, order, prime)


def _evaluate(coefficients: list[int], point: int, prime: int) -> int:
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


def validate_domain(prime: object, order: object, omega: object) -> dict[str, object]:
    """Judge a proposed evaluation domain (prime, order, omega).

    Malformed inputs are errors: ``invalid_prime``, ``invalid_order`` (an order
    outside ``1..4096``), ``invalid_omega`` (a non-integer). A well-formed triple
    that is not a real domain -- ``order`` does not divide ``prime - 1``, or
    ``omega`` does not have order exactly ``order`` -- is not an error. It is the
    answer ``{"ok": True, "valid": False}``.
    """
    failure = _parse_prime(prime)
    if failure is not None:
        return _error(failure)
    assert type(prime) is int
    if type(order) is not int or order < 1 or order > MAX_LENGTH:
        return _error("invalid_order")
    if type(omega) is not int:
        return _error("invalid_omega")
    return {"ok": True, "valid": _domain_ok(omega, order, prime)}


def fft(coefficients: object, omega: object, prime: object) -> dict[str, object]:
    """Evaluate a polynomial at the powers of `omega`, in index order.

    ``coefficients`` is ``[a0, a1, ...]`` with every ``ai`` in ``[0, prime)``; its
    length is the domain size n. The result is ``{"ok": True, "values": [...]}``
    with ``values[i] == f(omega ** i) mod prime`` for ``i`` in ``0..n-1`` -- that
    exact indexing is the contract, whatever recursion produced it.

    ``omega`` is handed in, not derived, and must have order exactly n over a
    ``prime`` where n divides ``prime - 1``. Anything less means the points repeat,
    the list is not an evaluation at n distinct points, and the reply is
    ``{"ok": False, "error": "invalid_domain"}`` rather than plausible numbers.
    """
    failure = _parse_prime(prime)
    if failure is not None:
        return _error(failure)
    assert type(prime) is int
    parsed = _parse_list(coefficients, prime)
    if parsed is None:
        return _error("invalid_coefficients")
    if not _domain_ok(omega, len(parsed), prime):
        return _error("invalid_domain")
    assert type(omega) is int

    values, point = [], 1
    for _ in range(len(parsed)):
        values.append(_evaluate(parsed, point, prime))
        point = point * omega % prime
    return {"ok": True, "values": values}


def ifft(values: object, omega: object, prime: object) -> dict[str, object]:
    """Recover the coefficients from evaluations at the powers of `omega`.

    The inverse runs at the powers of ``omega ** -1`` and scales by ``n ** -1``;
    forgetting either produces confidently wrong coefficients. The same domain
    contract applies: an omega whose order is not exactly ``len(values)`` is
    ``invalid_domain``, because repeated points cannot be inverted.
    """
    failure = _parse_prime(prime)
    if failure is not None:
        return _error(failure)
    assert type(prime) is int
    parsed = _parse_list(values, prime)
    if parsed is None:
        return _error("invalid_values")
    order = len(parsed)
    if not _domain_ok(omega, order, prime):
        return _error("invalid_domain")
    assert type(omega) is int

    inverse_omega = pow(omega, prime - 2, prime)
    inverse_order = pow(order % prime, prime - 2, prime)
    coefficients, point = [], 1
    for _ in range(order):
        coefficients.append(_evaluate(parsed, point, prime) * inverse_order % prime)
        point = point * inverse_omega % prime
    return {"ok": True, "coefficients": coefficients}


def interpolate_and_evaluate(
    values: object, omega: object, point: object, prime: object
) -> dict[str, object]:
    """Evaluate, at `point`, the unique degree-< n polynomial through the domain.

    The polynomial interpolates ``(omega ** i, values[i])`` for ``i`` in ``0..n-1``.
    ``point`` may or may not be one of those n points -- a member of the domain must
    come back as exactly its listed value, and both cases must go through arithmetic
    that cannot divide by zero. The result is ``{"ok": True, "value": f(point)}``.
    """
    failure = _parse_prime(prime)
    if failure is not None:
        return _error(failure)
    assert type(prime) is int
    parsed = _parse_list(values, prime)
    if parsed is None:
        return _error("invalid_values")
    if type(point) is not int or not 0 <= point < prime:
        return _error("invalid_point")
    if not _domain_ok(omega, len(parsed), prime):
        return _error("invalid_domain")

    recovered = ifft(parsed, omega, prime)
    assert recovered.get("ok") is True
    coefficients = recovered["coefficients"]
    assert isinstance(coefficients, list)
    return {"ok": True, "value": _evaluate(coefficients, point, prime)}
