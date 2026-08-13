"""Hidden property checks for the code checkpoints.

The claim is about one word in the contract: *primitive*. Everything here is built from
the definition of multiplicative order rather than from the reference, so a submission is
compared against the specification and not against one implementation of it.

Every parameter set is derived from the verifier seed, and each set deliberately mixes
primes where the textbook ``3 ** ((p-1)/n)`` rule lands on an element of order exactly n
with primes where it lands in a smaller subgroup. At least half of every set is the
second kind, so a submission that kept the rule fails for certain rather than by luck.
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
    """The rule the broken starter uses, reproduced so the failure can be explained."""
    return 1 if order == 1 else pow(3, (prime - 1) // order, prime)


def parameter_sets(seed: str, label: str, count: int) -> list[tuple[int, int]]:
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


def _coefficients(seed: str, label: str, prime: int, order: int) -> list[int]:
    rng = _rng(seed, f"{label}:{prime}:{order}")
    return [rng.randrange(prime) for _ in range(max(1, min(order, 1 + rng.randrange(order))))]


def _call(module: ModuleType, name: str, *args: object) -> object:
    try:
        return getattr(module, name)(*args)
    except Exception as error:  # noqa: BLE001 - a raising submission is a failed property
        return {"raised": type(error).__name__}


def _roots_failures(module: ModuleType, seed: str, phase: str, count: int) -> list[str]:
    """The omega a submission chooses must have order exactly n."""
    failures: list[str] = []
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        result = _call(module, "transform", [1], prime, order)
        if not isinstance(result, dict) or result.get("ok") is not True:
            failures.append(f"transform(p={prime}, n={order}) did not succeed")
            break
        omega = result.get("omega")
        if type(omega) is not int or not has_order(omega, order, prime):
            failures.append(
                f"transform(p={prime}, n={order}) returned omega={omega}, "
                f"which does not have order {order}"
            )
            break
    return failures


def _transform_failures(module: ModuleType, seed: str, phase: str, count: int) -> list[str]:
    failures = _roots_failures(module, seed, phase, count)
    if failures:
        return failures
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        coefficients = _coefficients(seed, phase, prime, order)
        result = _call(module, "transform", list(coefficients), prime, order)
        if not isinstance(result, dict) or result.get("ok") is not True:
            failures.append(f"transform(p={prime}, n={order}) did not succeed")
            break
        omega, values = result["omega"], result.get("values")
        if not isinstance(values, list) or len(values) != order:
            failures.append(f"transform(p={prime}, n={order}) did not return {order} values")
            break
        expected = [_evaluate(coefficients, pow(omega, i, prime), prime) for i in range(order)]
        if values != expected:
            failures.append(
                f"transform(p={prime}, n={order}) did not evaluate at the powers of its own omega"
            )
            break
    return failures


def _roundtrip_failures(module: ModuleType, seed: str, phase: str, count: int) -> list[str]:
    failures = _transform_failures(module, seed, phase, count)
    if failures:
        return failures
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        coefficients = _coefficients(seed, phase, prime, order)
        forward = _call(module, "transform", list(coefficients), prime, order)
        if not isinstance(forward, dict) or forward.get("ok") is not True:
            failures.append(f"transform(p={prime}, n={order}) did not succeed")
            break
        back = _call(
            module, "inverse_transform", list(forward["values"]), prime, order, forward["omega"]
        )
        padded = list(coefficients) + [0] * (order - len(coefficients))
        if not isinstance(back, dict) or back.get("ok") is not True:
            failures.append(f"inverse_transform(p={prime}, n={order}) did not succeed")
            break
        if back.get("coefficients") != padded:
            failures.append(
                f"inverse_transform(p={prime}, n={order}) returned "
                f"{back.get('coefficients')} instead of {padded}"
            )
            break

    # An omega whose powers repeat cannot be inverted. Accepting it and returning numbers
    # anyway is the same defect as choosing it in the first place.
    for prime, order in parameter_sets(seed, f"{phase}:sets", count):
        for candidate in (1, naive_omega(prime, order)):
            if has_order(candidate, order, prime):
                continue
            if _call(module, "inverse_transform", [0] * order, prime, order, candidate) != {
                "ok": False,
                "error": "invalid_omega",
            }:
                failures.append(
                    f"inverse_transform(p={prime}, n={order}) accepted omega={candidate}, "
                    f"whose order is not {order}"
                )
                return failures
        break
    return failures


def _transfer_failures(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _roundtrip_failures(module, seed, phase, 12)
    if failures:
        return failures

    rng = _rng(seed, f"{phase}:edges")
    prime = PRIMES[rng.randrange(len(PRIMES))]

    one = _call(module, "transform", [7 % prime], prime, 1)
    if not isinstance(one, dict) or one.get("ok") is not True or one.get("values") != [7 % prime]:
        failures.append("transform with order 1 did not return the single evaluation")

    # Orders that are not powers of two are legal whenever they divide p-1. A submission
    # that assumed a radix-2 shape passes everything above and fails here.
    odd = [d for d in orders_of(prime) if d > 2 and d % 2 == 1]
    if odd:
        order = odd[rng.randrange(len(odd))]
        result = _call(module, "transform", [1, 1], prime, order)
        if not isinstance(result, dict) or result.get("ok") is not True:
            failures.append(f"transform refused a legal odd order ({order} mod {prime})")
        elif not has_order(result.get("omega", 0), order, prime):
            failures.append(f"an odd order ({order} mod {prime}) did not get a real omega")

    non_divisor = next((d for d in range(2, prime) if (prime - 1) % d != 0), None)
    cases: list[tuple[tuple[object, ...], str]] = [
        (([1], 4, 2), "invalid_prime"),
        (([1], prime, 0), "invalid_order"),
        ((["x"], prime, 2), "invalid_coefficients"),
        (([prime], prime, 2), "invalid_coefficients"),
    ]
    if non_divisor is not None:
        cases.append((([1], prime, non_divisor), "invalid_order"))
    for args, expected in cases:
        if _call(module, "transform", *args) != {"ok": False, "error": expected}:
            failures.append(f"transform did not report {expected} for {args[1:]}")
    return failures


def check_roots(module: ModuleType, seed: str) -> list[str]:
    return _roots_failures(module, seed, "roots-checkpoint", 8)


def check_transform(module: ModuleType, seed: str) -> list[str]:
    return _transform_failures(module, seed, "transform-checkpoint", 8)


def check_roundtrip(module: ModuleType, seed: str) -> list[str]:
    return _roundtrip_failures(module, seed, "roundtrip-checkpoint", 10)


def check_transfer(module: ModuleType, seed: str) -> list[str]:
    return _transfer_failures(module, seed, "transfer-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _transfer_failures(module, seed, "full-run")
