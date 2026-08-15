"""A deliberately incomplete evaluation-domain toolkit.

The public contract is ``validate_domain(prime, order, omega)``,
``fft(coefficients, omega, prime)``, ``ifft(values, omega, prime)`` and
``interpolate_and_evaluate(values, omega, point, prime)``.

Every public test passes. The domains they use are ones where the one equation this
starter checks -- ``omega ** n == 1`` -- happens to be the whole truth.

TODO: omega is handed in and trusted after that single equation. An omega from a
*smaller* subgroup satisfies it too, and so can an order that does not even divide
p-1. Whatever you add to establish "order exactly n", add it here -- nothing else in
the image decides it for you.
"""

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
    """TODO: `omega ** order == 1` is satisfied by every element of every smaller
    subgroup as well, and nothing here asks whether `order` divides `prime - 1`."""
    return type(omega) is int and omega % prime != 0 and pow(omega, order, prime) == 1


def _evaluate(coefficients: list[int], point: int, prime: int) -> int:
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


def validate_domain(prime: object, order: object, omega: object) -> dict[str, object]:
    """Judge a proposed evaluation domain (prime, order, omega).

    Malformed inputs are errors: ``invalid_prime``, ``invalid_order`` (an order
    outside ``1..4096``), ``invalid_omega`` (a non-integer). A well-formed triple
    that is not a real domain must come back as ``{"ok": True, "valid": False}``.
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

    ``values[i] == f(omega ** i) mod prime`` for ``i`` in ``0..n-1`` where n is
    ``len(coefficients)``. A domain that cannot support the transform must be
    reported as ``{"ok": False, "error": "invalid_domain"}``.
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

    The inverse runs at the powers of ``omega ** -1`` and scales by ``n ** -1``. An
    omega the transform could not have used must be ``invalid_domain``.
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

    A member of the domain must come back as exactly its listed value, and both the
    member and non-member cases must go through arithmetic that cannot divide by
    zero. The result is ``{"ok": True, "value": f(point)}``.
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
    if recovered.get("ok") is not True:
        return recovered
    coefficients = recovered["coefficients"]
    assert isinstance(coefficients, list)
    return {"ok": True, "value": _evaluate(coefficients, point, prime)}
