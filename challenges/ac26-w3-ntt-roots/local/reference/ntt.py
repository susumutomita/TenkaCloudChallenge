"""Reference solution: the transform is only a transform if omega really has order n."""

from __future__ import annotations


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

    Both halves are needed. ``candidate ** order == 1`` on its own is satisfied by every
    element of every *smaller* subgroup, 1 included, so a rule that checks only that will
    happily hand back an omega whose powers repeat.
    """
    if candidate % prime == 0:
        return False
    if pow(candidate, order, prime) != 1:
        return False
    return all(pow(candidate, order // q, prime) != 1 for q in _prime_factors(order))


def primitive_root_of_unity(prime: int, order: int) -> int | None:
    """Some element of order exactly `order`, found by testing candidates.

    Which one is not specified: any element of the right order gives a valid transform,
    so the contract returns the omega that was used rather than fixing one.
    """
    if order == 1:
        return 1
    if (prime - 1) % order != 0:
        return None
    exponent = (prime - 1) // order
    for base in range(2, prime):
        candidate = pow(base, exponent, prime)
        if has_order(candidate, order, prime):
            return candidate
    return None


def _parse_params(prime: object, order: object) -> str | None:
    if type(prime) is not int or prime < 3 or prime > 1_000_003 or not _is_prime(prime):
        return "invalid_prime"
    if type(order) is not int or order < 1 or order > 4096:
        return "invalid_order"
    if (prime - 1) % order != 0:
        return "invalid_order"
    return None


def _parse_list(value: object, prime: int, length: int | None) -> list[int] | None:
    if not isinstance(value, list) or not value or len(value) > 4096:
        return None
    if length is not None and len(value) != length:
        return None
    for item in value:
        if type(item) is not int or not 0 <= item < prime:
            return None
    return list(value)


def _evaluate(coefficients: list[int], point: int, prime: int) -> int:
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


def transform(coefficients: object, prime: object, order: object) -> dict[str, object]:
    """Evaluate a polynomial at the `order` powers of a primitive order-th root of unity.

    ``coefficients`` is ``[a0, a1, ...]`` with every ``ai`` in ``[0, prime)`` and at most
    ``order`` entries. The result is ``{"ok": True, "omega": w, "values": [...]}`` where
    ``values[i] == f(w ** i) mod prime`` and ``w`` has multiplicative order exactly
    ``order``. That last part is what makes the list an evaluation at ``order``
    *distinct* points, and therefore something the inverse can undo.
    """
    failure = _parse_params(prime, order)
    if failure is not None:
        return _error(failure)
    assert isinstance(prime, int) and isinstance(order, int)
    parsed = _parse_list(coefficients, prime, None)
    if parsed is None or len(parsed) > order:
        return _error("invalid_coefficients")

    omega = primitive_root_of_unity(prime, order)
    if omega is None:
        return _error("no_root_of_unity")

    values, point = [], 1
    for _ in range(order):
        values.append(_evaluate(parsed, point, prime))
        point = point * omega % prime
    return {"ok": True, "omega": omega, "values": values}


def inverse_transform(
    values: object, prime: object, order: object, omega: object
) -> dict[str, object]:
    """Recover the coefficients from evaluations at the powers of `omega`.

    ``omega`` must have order exactly ``order``. Otherwise the points repeat and there is
    nothing to invert, so this reports ``invalid_omega`` rather than returning a plausible
    wrong answer. The result is padded to ``order`` entries.
    """
    failure = _parse_params(prime, order)
    if failure is not None:
        return _error(failure)
    assert isinstance(prime, int) and isinstance(order, int)
    parsed = _parse_list(values, prime, order)
    if parsed is None:
        return _error("invalid_values")
    if type(omega) is not int or not has_order(omega, order, prime):
        return _error("invalid_omega")

    inverse_omega = pow(omega, prime - 2, prime)
    inverse_order = pow(order % prime, prime - 2, prime)
    coefficients, point = [], 1
    for _ in range(order):
        coefficients.append(_evaluate(parsed, point, prime) * inverse_order % prime)
        point = point * inverse_omega % prime
    return {"ok": True, "coefficients": coefficients}
