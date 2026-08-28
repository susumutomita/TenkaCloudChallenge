"""Hidden tests. Run by /verify against a copy of the learner's rgsw.py.

Ground truth is `fixtures.generate`, never the submission. That matters most for the
external product: a checker that built the RGSW with the submission and multiplied with the
submission would pass any pair of functions that agree with each other, including a pair
that reverses the row layout on both sides. So RGSW rows built here are multiplied there,
and the other way round.

Every phase runs across several parameter sets. `params` varies the base, the level count
and the degree together, so an implementation that hardcodes any one of them fails a subset
rather than everything.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    decompose as reference_decompose,
    decompose_poly as reference_decompose_poly,
    external_product as reference_external_product,
    external_trace as reference_external_trace,
    gadget_vector as reference_gadget,
    levels_needed as reference_levels_needed,
    params as parameters,
    recompose as reference_recompose,
    recompose_poly as reference_recompose_poly,
    rgsw_encrypt as reference_rgsw_encrypt,
    rgsw_material,
    ring_noise,
    ring_random,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_secret,
    smallest_unrepresentable as reference_smallest,
)

LABELS = ("h0", "h1", "h2", "h3", "h4")


def _sets(seed: str) -> list[dict]:
    """Parameter sets covering both bases the generator can draw.

    Without the top-up a seed that drew base 2 five times would never exercise a base whose
    digits exceed one bit, where a decomposition that shifts instead of dividing still works.
    """
    drawn = [parameters(seed, label) for label in LABELS]
    for base in (2, 4):
        if not any(par["base"] == base for par in drawn):
            drawn.append(_forced(base))
    return drawn


def _forced(base: int) -> dict:
    """A viable set with the given base, for when the seed did not draw one."""
    from fixtures.generate import VIABLE

    levels, degree = next((l, d) for b, l, d in VIABLE if b == base)
    modulus = base**levels
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "modulus": modulus,
        "plaintext_modulus": 2,
        "delta": modulus // 2,
    }


def _sample(seed: str, par: dict, label: str) -> tuple:
    """A secret, a message, and the ciphertext carrying it."""
    secret = rlwe_secret(seed, par, label)
    messages = tuple(
        (index + 1) % par["plaintext_modulus"] for index in range(par["degree"])
    )
    ciphertext = rlwe_encrypt(
        par,
        secret,
        messages,
        ring_random(seed, par, f"ct:{label}"),
        ring_noise(seed, par, f"ct:{label}"),
    )
    return secret, messages, ciphertext


def check_decompose(module, seed: str) -> list[str]:
    """Scalar decomposition and its inverse."""
    failures: list[str] = []
    for par in _sets(seed):
        q, base, levels = par["modulus"], par["base"], par["levels"]
        probes = [0, 1, base - 1, base, q - 1, q // 3, q // 2 + 1]
        try:
            got = [tuple(module.decompose(par, v)) for v in probes]
        except Exception as error:  # noqa: BLE001
            return [f"decomposing raised {type(error).__name__}"]
        want = [reference_decompose(par, v) for v in probes]
        if got != want:
            if any(len(d) != levels for d in got):
                failures.append("a decomposition does not have exactly `levels` digits")
            elif any(not 0 <= digit < base for d in got for digit in d):
                failures.append("a digit is outside [0, base)")
            elif got == [tuple(reversed(d)) for d in want]:
                failures.append("the digits are least-significant first, not most")
            else:
                failures.append("a decomposition does not match the base-B digits")
            continue

        if any(module.recompose(par, d) != v % q for d, v in zip(want, probes)):
            failures.append("recomposing the digits does not return the value")
            continue
        if tuple(module.decompose(par, 0)) != tuple([0] * levels):
            failures.append("zero does not decompose to all-zero digits")
            continue
        # Deterministic, and defined on a raw integer as on its representative.
        if tuple(module.decompose(par, q + 5)) != reference_decompose(par, 5):
            failures.append("a value outside [0, q) is not reduced before decomposing")
    return failures


def check_gadget(module, seed: str) -> list[str]:
    """The gadget vector itself, checked directly rather than through a round trip.

    Reversing `decompose` and `recompose` together leaves the round trip intact, so the
    convention has to be pinned somewhere that a consistent reversal cannot hide.
    """
    failures: list[str] = []
    for par in _sets(seed):
        try:
            got = tuple(module.gadget_vector(par))
        except Exception as error:  # noqa: BLE001
            return [f"building the gadget vector raised {type(error).__name__}"]
        want = reference_gadget(par)
        if got != want:
            if got == tuple(reversed(want)):
                failures.append("the gadget vector is ascending, not descending")
            else:
                failures.append("the gadget vector is not the powers of the base")
            continue
        # And the identity that makes it a gadget: digits against powers rebuild the value.
        value = par["modulus"] // 3
        if sum(d * g for d, g in zip(module.decompose(par, value), got)) % par["modulus"] != value:
            failures.append("the digits and the gadget vector do not pair back to the value")
    return failures


def check_polynomial(module, seed: str) -> list[str]:
    """Per-coefficient decomposition, and the shape it has to come back in."""
    failures: list[str] = []
    for par in _sets(seed):
        _, _, ciphertext = _sample(seed, par, "poly")
        # Asymmetric on purpose: a transposed result has the same shape when levels == degree.
        probes = [ciphertext["a"], ciphertext["b"], tuple(range(par["degree"]))]
        try:
            got = [tuple(tuple(x) for x in module.decompose_poly(par, p)) for p in probes]
        except Exception as error:  # noqa: BLE001
            return [f"decomposing a polynomial raised {type(error).__name__}"]
        want = [reference_decompose_poly(par, p) for p in probes]
        if got != want:
            if any(len(level) != par["levels"] for level in got):
                failures.append("the result does not have one polynomial per level")
            elif got and want and got[0] == tuple(zip(*want[0])):
                failures.append("the levels and the coefficients are transposed")
            else:
                failures.append("a coefficient's digits are wrong or out of order")
            continue
        for probe in probes:
            rebuilt = tuple(module.recompose_poly(par, reference_decompose_poly(par, probe)))
            if rebuilt != reference_recompose_poly(par, reference_decompose_poly(par, probe)):
                failures.append("recomposing a polynomial does not return it")
                break

        # The external product multiplies a level by a ring element, so each level has to
        # be `degree` coefficients long -- not `levels` long, which is what a transpose gives.
        if any(len(level) != par["degree"] for level in want[0]):
            failures.append("a level is not a ring element")
        elif any(len(level) != par["degree"] for level in got[0]):
            failures.append("a level is not a ring element")
    return failures


def check_rgsw(module, seed: str) -> list[str]:
    """The 2L rows, the slot each gadget term sits in, and what must not be in there."""
    failures: list[str] = []
    for par in _sets(seed):
        levels = par["levels"]
        secret = rlwe_secret(seed, par, "rgsw")
        for selector in (0, 1):
            material = rgsw_material(seed, par, f"rgsw:{selector}")
            try:
                got = module.rgsw_encrypt(par, secret, selector, material)
            except Exception as error:  # noqa: BLE001
                return [f"encrypting an RGSW raised {type(error).__name__}"]
            want = reference_rgsw_encrypt(par, secret, selector, material)

            if len(got) != 2 * levels:
                failures.append(f"the RGSW has {len(got)} rows, not 2 * levels")
                return failures
            normalized = tuple((tuple(row[0]), tuple(row[1])) for row in got)
            if normalized != want:
                # The two halves are distinguishable, so say which one is wrong.
                if normalized[:levels] == want[:levels]:
                    failures.append("the rows at or above L do not carry the gadget in `b`")
                elif normalized[levels:] == want[levels:]:
                    failures.append("the rows below L do not carry the gadget in `a`")
                else:
                    failures.append("the RGSW rows are not Z + selector * G")
                break
            # A row is a ciphertext pair and nothing else. Anywhere the selector could be
            # kept is somewhere the external product could branch on it.
            if any(len(row) != 2 for row in got):
                failures.append("an RGSW row is not a single (a, b) pair")
                break

        # 0 and 1 have to produce different rows, or the selector is not being used at all.
        material = rgsw_material(seed, par, "rgsw:same")
        if module.rgsw_encrypt(par, secret, 0, material) == module.rgsw_encrypt(
            par, secret, 1, material
        ):
            failures.append("both selectors produced the same RGSW")

        # And it is a bit.
        for bad in (2, -1, "1"):
            try:
                module.rgsw_encrypt(par, secret, bad, rgsw_material(seed, par, "rgsw:bad"))
            except Exception:  # noqa: BLE001 - any refusal counts
                continue
            failures.append("a selector outside {0, 1} was accepted")
            break
    return failures


def check_external(module, seed: str) -> list[str]:
    """The semantics: selector 0 gives zero, selector 1 gives the message back."""
    failures: list[str] = []
    for par in _sets(seed):
        secret, messages, ciphertext = _sample(seed, par, "ext")
        zero = tuple([0] * par["degree"])
        for selector in (0, 1):
            material = rgsw_material(seed, par, f"ext:{selector}")
            want_messages = zero if selector == 0 else messages
            reference_rows = reference_rgsw_encrypt(par, secret, selector, material)

            try:
                mine = module.external_product(par, reference_rows, ciphertext)
            except Exception as error:  # noqa: BLE001
                return [f"the external product raised {type(error).__name__}"]
            if rlwe_decrypt(par, secret, {"a": tuple(mine["a"]), "b": tuple(mine["b"])}) != want_messages:
                failures.append(
                    f"selector {selector} did not produce "
                    + ("an encryption of zero" if selector == 0 else "the original message")
                )
                return failures

            # Crossed: the submission's rows through the reference product. A layout that
            # is wrong on both sides agrees with itself and fails here.
            own_rows = module.rgsw_encrypt(par, secret, selector, material)
            crossed = reference_external_product(
                par, tuple((tuple(r[0]), tuple(r[1])) for r in own_rows), ciphertext
            )
            if rlwe_decrypt(par, secret, crossed) != want_messages:
                failures.append("the submitted RGSW rows do not work in the reference product")
                return failures

        # The result must be a fresh ciphertext, not the input handed back. For selector 1
        # the plaintext is the same, so returning the input decrypts correctly -- and is not
        # an external product.
        material = rgsw_material(seed, par, "ext:1")
        rows = reference_rgsw_encrypt(par, secret, 1, material)
        out = module.external_product(par, rows, ciphertext)
        if (tuple(out["a"]), tuple(out["b"])) == (ciphertext["a"], ciphertext["b"]):
            failures.append("the external product returned its input unchanged")
    return failures


def check_trace(module, seed: str) -> list[str]:
    """One record per row, and the accumulator that ends at the product."""
    failures: list[str] = []
    for par in _sets(seed):
        secret, _, ciphertext = _sample(seed, par, "trace")
        rows = reference_rgsw_encrypt(par, secret, 1, rgsw_material(seed, par, "trace"))
        try:
            got = module.external_trace(par, rows, ciphertext)
        except Exception as error:  # noqa: BLE001
            return [f"tracing the external product raised {type(error).__name__}"]
        want = reference_external_trace(par, rows, ciphertext)

        if len(got) != len(want):
            failures.append("the trace does not have one record per row")
            continue
        for mine, theirs in zip(got, want):
            for key in ("row", "slot", "level"):
                if mine.get(key) != theirs[key]:
                    failures.append(f"a trace record's {key} is wrong")
                    return failures
            for key in ("digits", "partial_a", "partial_b", "accumulated_a", "accumulated_b"):
                if tuple(mine.get(key, ())) != tuple(theirs[key]):
                    failures.append(f"a trace record's {key} is wrong")
                    return failures
        # The trace is the computation, not a commentary on it.
        product = reference_external_product(par, rows, ciphertext)
        if tuple(got[-1]["accumulated_a"]) != product["a"] or tuple(
            got[-1]["accumulated_b"]
        ) != product["b"]:
            failures.append("the trace does not end at the product it describes")
    return failures


def check_failure(module, seed: str) -> list[str]:
    """What happens when the levels cannot reach the modulus."""
    failures: list[str] = []
    # (5, 125) and (6, 216) are the discriminating cases: `math.log(125, 5)` lands just
    # above 3.0 and ceils to 4. Without an exact power at a base above 4, a float
    # logarithm passes -- which is how it survived the first draft of this suite.
    cases = [
        (2, 8), (2, 100), (2, 128), (2, 129), (3, 81),
        (4, 256), (4, 257), (5, 125), (6, 216), (10, 1000), (5, 1),
    ]
    try:
        got = [module.levels_needed(base, modulus) for base, modulus in cases]
    except Exception as error:  # noqa: BLE001
        return [f"counting the needed levels raised {type(error).__name__}"]
    want = [reference_levels_needed(base, modulus) for base, modulus in cases]
    if got != want:
        # 2^7 = 128 needs 7 levels, and 129 needs 8. An implementation using a float
        # logarithm gets one of those two wrong.
        failures.append("the number of levels needed is off for at least one modulus")
        return failures

    probes = [(2, 3, 128), (2, 7, 128), (4, 2, 256), (4, 4, 256), (2, 4, 100), (3, 5, 81)]
    reported = [module.smallest_unrepresentable(b, l, q) for b, l, q in probes]
    expected = [reference_smallest(b, l, q) for b, l, q in probes]
    if reported != expected:
        failures.append("the smallest unrepresentable value is wrong")
        return failures

    # And it has to actually fail to round-trip, under the learner's own decompose.
    for base, levels, modulus in probes:
        witness = reference_smallest(base, levels, modulus)
        short = {
            "base": base,
            "levels": levels,
            "degree": 2,
            "modulus": modulus,
            "plaintext_modulus": 2,
            "delta": modulus // 2,
        }
        if witness is None:
            continue
        if module.recompose(short, module.decompose(short, witness)) == witness:
            failures.append("the reported witness round-trips, so it is not a counterexample")
            break
        # Everything below it must still round-trip, or the witness is not the smallest.
        if any(
            module.recompose(short, module.decompose(short, value)) != value
            for value in range(witness)
        ):
            failures.append("a value below the witness already fails, so it is not the smallest")
            break
    return failures


def check_transfer(module, seed: str) -> list[str]:
    """All of it, under a base, level count, degree and modulus not seen elsewhere."""
    failures: list[str] = []
    for phase in (
        check_decompose,
        check_gadget,
        check_polynomial,
        check_rgsw,
        check_external,
        check_trace,
    ):
        failures.extend(phase(module, seed))
    return failures


PHASES = (
    check_decompose,
    check_gadget,
    check_polynomial,
    check_rgsw,
    check_external,
    check_trace,
    check_failure,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
