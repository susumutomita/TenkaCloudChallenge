"""Author checks run in the trusted parent against untrusted element data.

Every selected element is tested; these finite cases do not prove all possible
implementations correct. The parent also validates every returned modulus and
arithmetic value via the class-shaped adapter. No child verdict is accepted.
Failure messages name public rules, not seeded operands or expected values.
"""

from __future__ import annotations

import sys
from math import gcd
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    composite_modulus,
    egcd as reference_egcd,
    egcd_rows,
    non_invertible,
    prime_modulus,
    sample_values,
    unit_modulus,
    PSEUDOPRIME_MODULUS,
)

LABELS = ("h0", "h1", "h2")


def _canonical(element, modulus: int) -> bool:
    value = getattr(element, "value", None)
    return type(value) is int and 0 <= value < modulus and type(getattr(getattr(element, "field", None), "modulus", None)) is int and element.field.modulus == modulus


def check_normalize(module, seed: str) -> list[str]:
    """An integer and a field element are different things, and this is where it shows."""
    failures: list[str] = []
    for label in LABELS:
        p = prime_modulus(seed, label)
        field = module.Field(p)
        for raw in sample_values(seed, label, p):
            try:
                element = field.element(raw)
            except Exception as error:  # noqa: BLE001
                return [f"building an element raised {type(error).__name__}"]
            if not _canonical(element, p):
                failures.append("an element is not a canonical representative in [0, p)")
                break
            if element.value != raw % p:
                failures.append("an element does not represent the integer it was built from")
                break
            # Normalizing twice must change nothing.
            if field.element(element.value).value != element.value:
                failures.append("normalization is not idempotent")
                break
            if not (element == field.element(raw)):
                failures.append("two elements built from the same integer are not equal")
                break
            equivalent = module.Field(p).element(raw + p)
            if element != equivalent or hash(element) != hash(equivalent):
                failures.append("equal normalized elements must compare equal and have equal hashes")
                break
            if element == module.Field(p + 1).element(element.value):
                failures.append("elements of different moduli must compare unequal")
                break
            if element == field.element(raw + 1) and p > 1:
                failures.append("elements built from different integers compare equal")
                break
    return failures


def check_arithmetic(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = prime_modulus(seed, label)
        field = module.Field(p)
        values = sample_values(seed, label, p)
        for a in values[:8]:
            for b in values[:8]:
                x, y = field.element(a), field.element(b)
                try:
                    got = [(x + y), (x - y), (x * y)]
                except Exception as error:  # noqa: BLE001
                    return [f"arithmetic raised {type(error).__name__}"]
                want = [(a + b) % p, (a - b) % p, (a * b) % p]
                for element, expected in zip(got, want):
                    if not _canonical(element, p):
                        failures.append("an arithmetic result is not a canonical element")
                        return failures
                    if element.value != expected:
                        failures.append("an arithmetic result is wrong")
                        return failures
        # Structure, not just values: identities, additive inverse, distributivity.
        zero, one = field.element(0), field.element(1)
        for raw in values[:8]:
            x = field.element(raw)
            if (x + zero) != x or (x * one) != x:
                failures.append("the additive or multiplicative identity does not hold")
                break
            if (x - x) != zero:
                failures.append("an element minus itself is not zero")
                break
        for a, b, c in zip(values[:5], values[1:6], values[2:7]):
            x, y, z = field.element(a), field.element(b), field.element(c)
            if (x * (y + z)) != ((x * y) + (x * z)):
                failures.append("multiplication does not distribute over addition")
                break
            if (x + y) != (y + x) or (x * y) != (y * x):
                failures.append("addition or multiplication is not commutative")
                break
            if ((x + y) + z) != (x + (y + z)) or ((x * y) * z) != (x * (y * z)):
                failures.append("addition or multiplication is not associative")
                break
    return failures


def check_egcd_trace(module, seed: str) -> list[str]:
    """The trace has to be the algorithm's, not a plausible-looking table."""
    failures: list[str] = []
    for label in LABELS:
        p = prime_modulus(seed, label)
        for raw in sample_values(seed, label, p)[:8]:
            a = raw % p
            if a == 0:
                continue
            try:
                rows = module.egcd_trace(a, p)
                g, s, t = module.egcd(a, p)
            except Exception as error:  # noqa: BLE001
                return [f"the extended Euclidean algorithm raised {type(error).__name__}"]
            want_g, want_s, want_t = reference_egcd(a, p)
            if any(type(v) is not int for v in (g, s, t)) or (g, s, t) != (want_g, want_s, want_t):
                failures.append("egcd does not return the algorithm's own coefficients")
                break
            if not isinstance(rows, (list, tuple)) or not rows:
                failures.append("the trace has no steps in it")
                break
            if any(not isinstance(row, dict) or any(type(row.get(k)) is not int for k in ("q", "r", "s", "t")) for row in rows):
                failures.append("a trace step is not a row of q, r, s and t")
                break
            if rows[-1]["r"] != want_g:
                failures.append("the trace's last remainder is not the gcd")
                break
            # Bezout has to hold at every step, not only at the end. A table that only
            # gets the last row right fails here.
            if any(a * row["s"] + p * row["t"] != row["r"] for row in rows):
                failures.append("a trace step does not satisfy a*s + p*t == r")
                break
            if rows[-1]["s"] % p != want_s % p:
                failures.append("the trace's last coefficient is not the one egcd returns")
                break
            # Per-row Bezout and a correct last row are satisfied by a table holding
            # only the last row, so the step sequence itself is compared. Floor division
            # makes it deterministic, so there is exactly one right answer.
            want_rows = egcd_rows(a, p)
            if len(rows) != len(want_rows):
                failures.append("the trace does not have one row per division step")
                break
            if any(
                row.get(key) != want.get(key)
                for row, want in zip(rows, want_rows)
                for key in ("q", "r", "s", "t")
            ):
                failures.append("a trace row is not the step the algorithm takes there")
                break
    return failures


def check_inverse(module, seed: str) -> list[str]:
    """Every non-zero element of a prime field, not a sample of them."""
    failures: list[str] = []
    for label in LABELS:
        p = prime_modulus(seed, label)
        field = module.Field(p)
        for raw in range(1, p):
            x = field.element(raw)
            try:
                inv = x.inverse()
            except Exception as error:  # noqa: BLE001
                return [f"inverting a non-zero element raised {type(error).__name__}"]
            if not _canonical(inv, p):
                failures.append("an inverse is not a canonical element")
                break
            if raw * inv.value % p != 1 or (x * inv).value != 1:
                failures.append("an element times its inverse is not one")
                break
        for raw in sample_values(seed, label, p)[:8]:
            b = field.element(raw)
            if b.value == 0:
                continue
            a = field.element(raw + 7)
            try:
                if ((a / b) * b) != a:
                    failures.append("dividing then multiplying does not return the original")
                    break
            except Exception as error:  # noqa: BLE001
                return [f"division raised {type(error).__name__}"]
    return failures


def check_errors(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = prime_modulus(seed, label)
        field = module.Field(p)
        try:
            field.element(0).inverse()
            failures.append("zero was given an inverse instead of an error")
        except module.NotInvertible:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"inverting zero raised {type(error).__name__}, not NotInvertible")
        try:
            field.element(3) / field.element(0)
            failures.append("division by zero was allowed")
        except module.NotInvertible:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"dividing by zero raised {type(error).__name__}, not NotInvertible")

        other = module.Field(composite_modulus(seed, label))
        for operation in (lambda x,y: x+y, lambda x,y: x-y, lambda x,y: x*y, lambda x,y: x/y):
            try:
                operation(field.element(3), other.element(3))
                failures.append("elements of different moduli were combined without FieldMismatch")
            except module.FieldMismatch:
                pass
            except Exception as error:
                failures.append(f"mixing moduli raised {type(error).__name__}, not FieldMismatch")
    return failures


def check_composite(module, seed: str) -> list[str]:
    """Where `pow(a, n-2, n)` quietly returns a wrong answer and egcd does not."""
    failures: list[str] = []
    for label in LABELS:
        n = composite_modulus(seed, label)
        ring = module.Field(n)
        try:
            witness = module.non_invertible_element(n)
        except Exception as error:  # noqa: BLE001
            return [f"finding a non-invertible element raised {type(error).__name__}"]
        if type(witness) is not int or witness != non_invertible(seed, n):
            failures.append("that element is not the smallest non-invertible one")
            continue
        try:
            ring.element(witness).inverse()
            failures.append("a non-invertible element was given an inverse")
        except module.NotInvertible:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"inverting it raised {type(error).__name__}, not NotInvertible")

        # And a prime modulus must report no such element, so the answer is not just
        # "always return something".
        p = prime_modulus(seed, label)
        no_witness = module.non_invertible_element(p)
        if type(no_witness) is not int or no_witness != 0:
            failures.append("a prime modulus was reported to have a non-invertible element")
    return failures


def _check_units_modulus(module, modulus: int) -> list[str]:
    """One modulus, every element. Empty means it passes.

    The rule is the one the starter docstring states: an element sharing a factor with
    the modulus raises NotInvertible, every other non-zero element returns the partner
    that multiplies back to one -- and `/` follows `inverse()`. Over a prime modulus the
    first set is empty and this is the old axioms check; over a composite one the two
    sets are mixed, and a table cannot carry over because the modulus is never shown.
    """
    ring = module.Field(modulus)
    try:
        elements = [ring.element(v) for v in range(modulus)]
    except Exception as error:  # noqa: BLE001
        return [f"building an element raised {type(error).__name__}"]
    if any(not _canonical(x, modulus) for x in elements):
        return ["an element is not a canonical representative in [0, modulus)"]
    for x in elements[: min(modulus, 24)]:
        for y in elements[: min(modulus, 24)]:
            try:
                if not _canonical(x + y, modulus) or not _canonical(x * y, modulus):
                    return ["closure fails: an arithmetic result is outside [0, modulus)"]
            except Exception as error:  # noqa: BLE001
                return [f"arithmetic raised {type(error).__name__}"]

    invertible = {v for v in range(1, modulus) if gcd(v, modulus) == 1}
    partners: set[int] = set()
    for x in elements[1:]:
        try:
            inverse = x.inverse()
        except module.NotInvertible:
            if x.value in invertible:
                return ["an element sharing no factor with the modulus was refused an inverse"]
            continue
        except Exception as error:  # noqa: BLE001
            return [f"inverting an element raised {type(error).__name__}"]
        if x.value not in invertible:
            return ["an element sharing a factor with the modulus was given an inverse"]
        if not _canonical(inverse, modulus):
            return ["an inverse is not a canonical element"]
        if x.value * inverse.value % modulus != 1 or (x * inverse).value != 1:
            return ["an element times its inverse is not one"]
        partners.add(inverse.value)
    # The inverse is unique, so the partners of the invertible elements are exactly the
    # invertible elements again, each once.
    if partners != invertible:
        return ["inversion is not one-to-one on the elements that have an inverse"]

    # Division follows inversion: by an invertible element it undoes multiplication, by
    # anything else it raises. Every divisor, not a sample -- a `/` that special-cases
    # the smallest values passed the sampled version of this check.
    for divisor in range(1, modulus):
        b = ring.element(divisor)
        a = ring.element(divisor + 7)
        try:
            quotient = a / b
        except module.NotInvertible:
            if divisor in invertible:
                return ["dividing by an element that has an inverse raised NotInvertible"]
            continue
        except Exception as error:  # noqa: BLE001
            return [f"division raised {type(error).__name__}"]
        if divisor not in invertible:
            return ["dividing by an element with no inverse did not raise NotInvertible"]
        if (quotient * b) != a:
            return ["dividing then multiplying does not return the original"]
    return []


def check_units(module, seed: str) -> list[str]:
    """Every element of a composite modulus the learner has not seen, then of a prime.

    Where `pow(a, m - 2, m)` behind a gcd guard finally fails: over a composite modulus
    it returns a number for every unit and the inverse for only some of them, while the
    extended Euclidean table gets every element right without knowing whether the
    modulus is prime. Closure and the one-to-one property the earlier `axioms`
    checkpoint checked over a prime are kept, over both moduli.
    """
    failures: list[str] = []
    for modulus in (unit_modulus(seed), PSEUDOPRIME_MODULUS, prime_modulus(seed, "units")):
        failures.extend(_check_units_modulus(module, modulus))
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_normalize(module, seed),
        *check_arithmetic(module, seed),
        *check_egcd_trace(module, seed),
        *check_inverse(module, seed),
        *check_errors(module, seed),
        *check_composite(module, seed),
        *check_units(module, seed),
    ]
