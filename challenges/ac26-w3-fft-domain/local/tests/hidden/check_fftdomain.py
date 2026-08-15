"""Hidden property checks for the code checkpoints.

The claim is about one word in the contract: *domain*. A handed omega is only an
evaluation domain when its order is exactly n over a prime where n divides p-1.
Everything here is built from the definition of multiplicative order rather than from
the reference, so a submission is compared against the specification and not against
one implementation of it.

Every parameter set mixes primes where the textbook ``3 ** ((p-1)/n)`` element really
has order n with primes where it lands in a smaller subgroup while still satisfying
``omega ** n == 1``. At least half of every set is the second kind, so a submission
that trusts that one equation fails for certain rather than by luck.
"""

from __future__ import annotations

import hashlib
import random
from types import ModuleType

PRIMES = (13, 17, 29, 41, 73, 97, 113, 193, 257, 337, 641, 769, 1009, 1153, 3457, 7681)


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


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
    """Order exactly `order`: a power that returns 1, and no smaller one that does."""
    if candidate % prime == 0 or pow(candidate, order, prime) != 1:
        return False
    return all(pow(candidate, order // q, prime) != 1 for q in _prime_factors(order))


def orders_of(prime: int) -> list[int]:
    return [d for d in range(1, prime) if (prime - 1) % d == 0]


def naive_omega(prime: int, order: int) -> int:
    """The rule the broken starter trusts, reproduced so the failure can be explained."""
    return 1 if order == 1 else pow(3, (prime - 1) // order, prime)


def real_omega(prime: int, order: int) -> int | None:
    """Some element of order exactly `order`, found from the definition."""
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


def parameter_sets(seed: str, label: str, count: int) -> list[tuple[int, int]]:
    """(prime, order) pairs, at least half of them textbook-rule traps."""
    rng = _rng(seed, label)
    sound: list[tuple[int, int]] = []
    unsound: list[tuple[int, int]] = []
    for prime in PRIMES:
        for order in orders_of(prime):
            if order < 2 or order > 128:
                continue
            target = sound if has_order(naive_omega(prime, order), order, prime) else unsound
            target.append((prime, order))
    rng.shuffle(sound)
    rng.shuffle(unsound)
    take = max(count // 2, 1)
    picked = unsound[:take] + sound[: max(count - take, 0)]
    rng.shuffle(picked)
    return picked


def _evaluate(coefficients: list[int], point: int, prime: int) -> int:
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


def _inverse_coefficients(values: list[int], omega: int, prime: int) -> list[int]:
    """The checker's own inverse, from the definition, for comparison material."""
    order = len(values)
    inverse_omega = pow(omega, prime - 2, prime)
    inverse_order = pow(order % prime, prime - 2, prime)
    coefficients, point = [], 1
    for _ in range(order):
        coefficients.append(_evaluate(values, point, prime) * inverse_order % prime)
        point = point * inverse_omega % prime
    return coefficients


def _values(seed: str, label: str, prime: int, order: int) -> list[int]:
    rng = _rng(seed, f"{label}:{prime}:{order}")
    return [rng.randrange(prime) for _ in range(order)]


def _call(module: ModuleType, name: str, *args: object) -> object:
    try:
        return getattr(module, name)(*args)
    except Exception as error:  # noqa: BLE001 - a raising submission is a failed property
        return {"raised": type(error).__name__}


def _domain_failures(module: ModuleType, seed: str, phase: str, count: int) -> list[str]:
    """A handed omega is judged by its order, and a fake domain is never computed on."""
    failures: list[str] = []
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        omega = real_omega(prime, order)
        if omega is None:
            continue
        verdict = _call(module, "validate_domain", prime, order, omega)
        if verdict != {"ok": True, "valid": True}:
            failures.append(
                f"validate_domain(p={prime}, n={order}, omega={omega}) rejected a real domain"
            )
            break
        fake = naive_omega(prime, order)
        for candidate in {1, fake} - {omega}:
            if has_order(candidate, order, prime):
                continue
            verdict = _call(module, "validate_domain", prime, order, candidate)
            if verdict != {"ok": True, "valid": False}:
                failures.append(
                    f"validate_domain(p={prime}, n={order}, omega={candidate}) called a "
                    f"lower-order element a domain"
                )
                return failures
            probe = _values(seed, phase, prime, order)
            if _call(module, "fft", probe, candidate, prime) != {
                "ok": False,
                "error": "invalid_domain",
            }:
                failures.append(
                    f"fft accepted omega={candidate} over p={prime}, whose order is not {order}"
                )
                return failures
            if _call(module, "ifft", probe, candidate, prime) != {
                "ok": False,
                "error": "invalid_domain",
            }:
                failures.append(
                    f"ifft accepted omega={candidate} over p={prime}, whose order is not {order}"
                )
                return failures
        # Too large an order is as fake as too small: an element of order 2n satisfies
        # every proper-divisor inequality for n and still fails omega ** n == 1.
        if (prime - 1) % (order * 2) == 0:
            bigger = real_omega(prime, order * 2)
            if bigger is not None:
                verdict = _call(module, "validate_domain", prime, order, bigger)
                if verdict != {"ok": True, "valid": False}:
                    failures.append(
                        f"validate_domain(p={prime}, n={order}, omega={bigger}) called a "
                        f"higher-order element a domain"
                    )
                    return failures
    if failures:
        return failures

    # An order that does not divide p-1 has no subgroup at all. omega=1 satisfies
    # omega ** n == 1 there, which is exactly why that one equation is not the test.
    for prime in (PRIMES[3], PRIMES[9]):
        non_divisor = next(d for d in range(2, prime) if (prime - 1) % d != 0)
        verdict = _call(module, "validate_domain", prime, non_divisor, 1)
        if verdict != {"ok": True, "valid": False}:
            failures.append(
                f"validate_domain(p={prime}, n={non_divisor}) accepted an order that does "
                f"not divide p-1"
            )
            return failures
        if _call(module, "fft", [1] * non_divisor, 1, prime) != {
            "ok": False,
            "error": "invalid_domain",
        }:
            failures.append(
                f"fft(p={prime}, n={non_divisor}) computed over an order that does not "
                f"divide p-1"
            )
            return failures
    return failures


def _roundtrip_failures(module: ModuleType, seed: str, phase: str, count: int) -> list[str]:
    failures = _domain_failures(module, seed, phase, count)
    if failures:
        return failures
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        omega = real_omega(prime, order)
        if omega is None:
            continue
        coefficients = _values(seed, f"{phase}:coeff", prime, order)
        forward = _call(module, "fft", list(coefficients), omega, prime)
        if not isinstance(forward, dict) or forward.get("ok") is not True:
            failures.append(f"fft(p={prime}, n={order}) did not succeed on a real domain")
            break
        values = forward.get("values")
        if not isinstance(values, list) or len(values) != order:
            failures.append(f"fft(p={prime}, n={order}) did not return {order} values")
            break
        back = _call(module, "ifft", list(values), omega, prime)
        if not isinstance(back, dict) or back.get("ok") is not True:
            failures.append(f"ifft(p={prime}, n={order}) did not succeed on a real domain")
            break
        if back.get("coefficients") != coefficients:
            failures.append(
                f"ifft(fft(f)) over p={prime}, n={order} returned "
                f"{back.get('coefficients')} instead of the original coefficients"
            )
            break
    if failures:
        return failures

    prime = 13
    one = _call(module, "fft", [7], 1, prime)
    if not isinstance(one, dict) or one.get("ok") is not True or one.get("values") != [7]:
        failures.append("fft with n=1 and omega=1 did not return the single evaluation")
    return failures


def _ordering_failures(module: ModuleType, seed: str, phase: str, count: int) -> list[str]:
    """values[i] is f at omega ** i -- that indexing, not a permutation of it."""
    failures = _roundtrip_failures(module, seed, phase, count)
    if failures:
        return failures
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        if order < 3:
            continue
        omega = real_omega(prime, order)
        if omega is None:
            continue
        # f(x) = x: the values must be the powers themselves, in index order. Any
        # bit-reversal or recursion-order leak scrambles exactly this list.
        identity = [0, 1] + [0] * (order - 2)
        forward = _call(module, "fft", list(identity), omega, prime)
        expected_points = [pow(omega, i, prime) for i in range(order)]
        if not isinstance(forward, dict) or forward.get("values") != expected_points:
            failures.append(
                f"fft(f(x)=x) over p={prime}, n={order} did not list the powers of omega "
                f"in index order"
            )
            break
        # A unit coefficient at position k: values[i] must be omega ** (i*k).
        rng = _rng(seed, f"{phase}:unit:{prime}:{order}")
        position = rng.randrange(1, order)
        unit = [0] * order
        unit[position] = 1
        forward = _call(module, "fft", list(unit), omega, prime)
        expected = [pow(omega, (i * position) % order, prime) for i in range(order)]
        if not isinstance(forward, dict) or forward.get("values") != expected:
            failures.append(
                f"fft(x**{position}) over p={prime}, n={order} put its values at the "
                f"wrong indexes"
            )
            break
        recovered = _call(module, "ifft", expected, omega, prime)
        if not isinstance(recovered, dict) or recovered.get("coefficients") != unit:
            failures.append(
                f"ifft over p={prime}, n={order} recovered x**{position} at the wrong index"
            )
            break
    return failures


def _interpolate_failures(module: ModuleType, seed: str, phase: str, count: int) -> list[str]:
    failures = _ordering_failures(module, seed, phase, count)
    if failures:
        return failures
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        omega = real_omega(prime, order)
        if omega is None:
            continue
        values = _values(seed, f"{phase}:values", prime, order)
        points = [pow(omega, i, prime) for i in range(order)]

        rng = _rng(seed, f"{phase}:pick:{prime}:{order}")
        member_index = rng.randrange(order)
        member = _call(
            module, "interpolate_and_evaluate", list(values), omega, points[member_index], prime
        )
        if member != {"ok": True, "value": values[member_index]}:
            failures.append(
                f"a domain member (omega**{member_index} over p={prime}, n={order}) did not "
                f"come back as its listed value"
            )
            break

        outside = next(
            (x for x in rng.sample(range(prime), min(prime, 40)) if x not in points), None
        )
        if outside is None:
            continue
        expected = _evaluate(_inverse_coefficients(values, omega, prime), outside, prime)
        answer = _call(module, "interpolate_and_evaluate", list(values), omega, outside, prime)
        if answer != {"ok": True, "value": expected}:
            failures.append(
                f"interpolation at a non-member point over p={prime}, n={order} returned "
                f"{answer!r} instead of the polynomial's value"
            )
            break
    if failures:
        return failures

    prime = 97
    omega = real_omega(prime, 8)
    assert omega is not None
    flat = _call(module, "interpolate_and_evaluate", [5] * 8, omega, 3, prime)
    if flat != {"ok": True, "value": 5}:
        failures.append("a constant polynomial did not interpolate to its constant")
    on_domain = _call(
        module, "interpolate_and_evaluate", [5] * 8, omega, pow(omega, 2, prime), prime
    )
    if on_domain != {"ok": True, "value": 5}:
        failures.append(
            "a constant polynomial did not interpolate to its constant on a domain point"
        )
    if _call(module, "interpolate_and_evaluate", [0] * 8, omega, prime, prime) != {
        "ok": False,
        "error": "invalid_point",
    }:
        failures.append("a point outside [0, p) was not reported as invalid_point")
    return failures


def _generalize_failures(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _interpolate_failures(module, seed, phase, 12)
    if failures:
        return failures

    rng = _rng(seed, f"{phase}:edges")
    prime = PRIMES[rng.randrange(len(PRIMES))]

    # Odd orders are legal whenever they divide p-1; a radix-2 assumption dies here.
    odd = [d for d in orders_of(prime) if 2 < d <= 128 and d % 2 == 1]
    if odd:
        order = odd[rng.randrange(len(odd))]
        omega = real_omega(prime, order)
        if omega is not None:
            coefficients = _values(seed, f"{phase}:odd", prime, order)
            forward = _call(module, "fft", list(coefficients), omega, prime)
            expected = [
                _evaluate(coefficients, pow(omega, i, prime), prime) for i in range(order)
            ]
            if not isinstance(forward, dict) or forward.get("values") != expected:
                failures.append(f"a legal odd order ({order} mod {prime}) was not transformed")

    non_divisor = next((d for d in range(2, prime) if (prime - 1) % d != 0), None)
    cases: list[tuple[str, tuple[object, ...], str]] = [
        ("validate_domain", (4, 2, 1), "invalid_prime"),
        ("validate_domain", (prime, 0, 1), "invalid_order"),
        ("validate_domain", (prime, 2, "3"), "invalid_omega"),
        ("fft", (["x"], 1, prime), "invalid_coefficients"),
        ("fft", ([prime], 1, prime), "invalid_coefficients"),
        ("ifft", ([], 1, prime), "invalid_values"),
        ("interpolate_and_evaluate", ([0, 0], 1, "3", prime), "invalid_point"),
    ]
    for name, args, expected_error in cases:
        if _call(module, name, *args) != {"ok": False, "error": expected_error}:
            failures.append(f"{name} did not report {expected_error} for {args!r}")
    if non_divisor is not None:
        verdict = _call(module, "validate_domain", prime, non_divisor, 1)
        if verdict != {"ok": True, "valid": False}:
            failures.append(
                f"validate_domain(p={prime}, n={non_divisor}) accepted a non-dividing order"
            )
    return failures


def check_domain(module: ModuleType, seed: str) -> list[str]:
    return _domain_failures(module, seed, "domain-checkpoint", 10)


def check_roundtrip(module: ModuleType, seed: str) -> list[str]:
    return _roundtrip_failures(module, seed, "roundtrip-checkpoint", 10)


def check_ordering(module: ModuleType, seed: str) -> list[str]:
    return _ordering_failures(module, seed, "ordering-checkpoint", 8)


def check_interpolate(module: ModuleType, seed: str) -> list[str]:
    return _interpolate_failures(module, seed, "interpolate-checkpoint", 8)


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _generalize_failures(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _generalize_failures(module, seed, "full-run")
