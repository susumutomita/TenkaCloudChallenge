"""A deliberately incomplete number-theoretic transform.

The public contract is ``transform(coefficients, prime, order)`` and
``inverse_transform(values, prime, order, omega)``.

Every public test passes. The parameter sets they use are ones where the rule below
happens to land on an element of the right order.

TODO: omega comes out of a fixed rule and is used without checking what it actually is,
and `inverse_transform` accepts whatever omega it is handed. Both are the same missing
idea. Whatever you add to establish it, add it here -- nothing else in the image
computes it for you.
"""

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


def primitive_root_of_unity(prime: int, order: int) -> int | None:
    """The textbook one-liner: raise a small base to (p-1)/order.

    TODO: this returns an element whose order *divides* `order`. Nothing here decides
    whether it is `order` itself, and the two are not the same thing.
    """
    if order == 1:
        return 1
    if (prime - 1) % order != 0:
        return None
    return pow(3, (prime - 1) // order, prime)


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
    if type(omega) is not int or omega % prime == 0:
        return _error("invalid_omega")

    inverse_omega = pow(omega, prime - 2, prime)
    inverse_order = pow(order % prime, prime - 2, prime)
    coefficients, point = [], 1
    for _ in range(order):
        coefficients.append(_evaluate(parsed, point, prime) * inverse_order % prime)
        point = point * inverse_omega % prime
    return {"ok": True, "coefficients": coefficients}
