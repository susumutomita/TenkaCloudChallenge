"""Hidden tests. Run by /verify against a copy of the learner's lattice.py.

Ground truth comes from `fixtures.generate`, never from the submission. The rule matters
most for the two checkpoints that could otherwise be graded against themselves:
`correspondence` asserts an identity about `ring_mul`, and grading it with the submission's
own `ring_mul` would accept a coefficient vector and a product that are wrong together.
Both sides come from the fixtures instead.

Every phase runs across several parameter sets, and `_sets` guarantees the collection spans
both parities of `delta` and both ring degrees. Without the guarantee the suite would
silently stop testing the asymmetric noise interval, or stop testing a degree the learner
did not happen to hardcode, whenever a seed drew six of the same.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    boundary_samples,
    first_failing_index as reference_first_failing_index,
    invalid_ciphertexts,
    lwe_case,
    lwe_encrypt as reference_lwe_encrypt,
    lwe_phase as reference_lwe_phase,
    noise_interval as reference_interval,
    normalize as reference_normalize,
    params as parameters,
    phase_coefficient_terms as reference_terms,
    raw_sequence,
    ring_add as reference_ring_add,
    ring_element,
    ring_mul as reference_ring_mul,
    ring_sub as reference_ring_sub,
    rlwe_case,
    rlwe_encrypt as reference_rlwe_encrypt,
    rlwe_phase as reference_rlwe_phase,
    secret as reference_secret,
    surviving_samples,
    valid_ciphertexts,
)

LABELS = ("h0", "h1", "h2", "h3", "h4", "h5")


def _sets(seed: str) -> list[tuple[str, dict]]:
    """Labelled parameter sets spanning both delta parities and both ring degrees.

    A synthesized set keeps its own label so the seed-derived cases built on top of it are
    that set's cases and not another's.
    """
    drawn = [(label, parameters(seed, label)) for label in LABELS]
    base = drawn[0][1]
    if all(par["delta"] % 2 for _, par in drawn):
        drawn.append(("even-delta", {**base, "delta": 16, "q": base["p"] * 16}))
    if all(par["delta"] % 2 == 0 for _, par in drawn):
        drawn.append(("odd-delta", {**base, "delta": 9, "q": base["p"] * 9}))
    if all(par["degree"] == base["degree"] for _, par in drawn):
        drawn.append(("other-degree", {**base, "degree": 8 if base["degree"] == 4 else 4}))
    return drawn


def _tuple(value) -> tuple:
    """Compare by value, not by container type: a list of coefficients is a ring element."""
    return tuple(value) if isinstance(value, (tuple, list)) else value


def check_normalize(module, seed: str) -> list[str]:
    """Canonicalization, including the degrees a product can never reach."""
    failures: list[str] = []
    for label, par in _sets(seed):
        n, q = par["degree"], par["q"]
        # Lengths on both sides of N and past 2N. Only the last group can tell a periodic
        # sign flip from a one-way threshold, and no convolution of ring elements gets there.
        lengths = (0, 1, n - 1, n, n + 1, 2 * n - 1, 2 * n, 2 * n + 1, 3 * n)
        try:
            for index, length in enumerate(lengths):
                raw = raw_sequence(seed, f"{label}:norm:{index}", length, -3 * q, 3 * q)
                if _tuple(module.normalize(par, raw)) != reference_normalize(par, raw):
                    failures.append(
                        "a sequence does not reduce to its canonical ring element"
                        if length <= n
                        else "a coefficient above degree N folds back with the wrong sign"
                    )
                    break
        except Exception as error:  # noqa: BLE001
            return [f"normalization raised {type(error).__name__}"]
        if failures:
            continue

        # A basis vector at degree N is -1 at degree 0, and at degree 2N it is +1 again.
        for degree, expected in ((n, [-1]), (2 * n, [1]), (3 * n, [-1])):
            unit = [0] * degree + [1]
            if _tuple(module.normalize(par, unit)) != reference_normalize(par, expected):
                failures.append("X^N is not -1 in this ring")
                break
        if failures:
            continue

        # Shape, range, and idempotence.
        sample = raw_sequence(seed, f"{label}:norm:shape", 2 * n + 1, -2 * q, 2 * q)
        canonical = _tuple(module.normalize(par, sample))
        if len(canonical) != n:
            failures.append("a canonical ring element does not have exactly N coefficients")
            continue
        if any(not 0 <= value < q for value in canonical):
            failures.append("a canonical coefficient falls outside [0, q)")
            continue
        if _tuple(module.normalize(par, canonical)) != canonical:
            failures.append("normalizing an already-canonical element changed it")
    return failures


def check_ring(module, seed: str) -> list[str]:
    """Addition, subtraction, and the negacyclic product."""
    failures: list[str] = []
    for label, par in _sets(seed):
        n = par["degree"]
        f = ring_element(par, seed, f"{label}:f")
        g = ring_element(par, seed, f"{label}:g")
        h = ring_element(par, seed, f"{label}:h")
        try:
            if _tuple(module.ring_add(par, f, g)) != reference_ring_add(par, f, g):
                failures.append("addition is not coefficient-wise in the ring")
                continue
            if _tuple(module.ring_sub(par, f, g)) != reference_ring_sub(par, f, g):
                failures.append("subtraction is not coefficient-wise in the ring")
                continue
            if _tuple(module.ring_mul(par, f, g)) != reference_ring_mul(par, f, g):
                failures.append("the product is not the negacyclic one")
                continue
        except Exception as error:  # noqa: BLE001
            return [f"a ring operation raised {type(error).__name__}"]

        # X^(N-1) * X = X^N = -1. This is the relation the whole ring is named after, and a
        # cyclic convolution gets +1 here instead.
        top = [0] * (n - 1) + [1]
        shift = [0, 1] + [0] * (n - 2)
        if _tuple(module.ring_mul(par, top, shift)) != reference_normalize(par, [-1]):
            failures.append("X^(N-1) * X is not -1")
            continue

        # Metamorphic, so it cannot be satisfied by memorizing one product.
        if _tuple(module.ring_mul(par, f, g)) != _tuple(module.ring_mul(par, g, f)):
            failures.append("the product is not commutative")
            continue
        left = _tuple(module.ring_mul(par, f, reference_ring_add(par, g, h)))
        right = reference_ring_add(
            par, _tuple(module.ring_mul(par, f, g)), _tuple(module.ring_mul(par, f, h))
        )
        if left != right:
            failures.append("the product does not distribute over addition")
            continue

        # A ring element times 1 is itself; times 0 is 0.
        one = [1] + [0] * (n - 1)
        if _tuple(module.ring_mul(par, f, one)) != reference_normalize(par, f):
            failures.append("multiplying by 1 changed the element")
            continue
        if _tuple(module.ring_sub(par, f, f)) != reference_normalize(par, [0]):
            failures.append("subtracting an element from itself is not zero")
    return failures


def check_lwe(module, seed: str) -> list[str]:
    """Encrypt, cancel the secret, decode."""
    failures: list[str] = []
    for label, par in _sets(seed):
        q = par["q"]
        for index in range(3):
            case = lwe_case(par, seed, label, index)
            secret, message = case["secret"], case["message"]
            try:
                produced = module.lwe_encrypt(par, secret, message, case["mask"], case["error"])
            except Exception as error:  # noqa: BLE001
                return [f"LWE encryption raised {type(error).__name__}"]
            expected = reference_lwe_encrypt(par, secret, message, case["mask"], case["error"])
            if (_tuple(produced[0]), produced[1]) != expected:
                failures.append("an LWE ciphertext is not <a, s> + encode(m) + e")
                break
            if any(not 0 <= value < q for value in produced[0]) or not 0 <= produced[1] < q:
                failures.append("an LWE ciphertext leaves this function non-canonical")
                break
            try:
                if module.lwe_phase(par, secret, expected) != reference_lwe_phase(
                    par, secret, expected
                ):
                    failures.append("the phase does not cancel the secret out of the body")
                    break
                if module.lwe_decrypt(par, secret, expected) != message:
                    failures.append("an LWE round trip does not return the message")
                    break
            except Exception as error:  # noqa: BLE001
                return [f"LWE decryption raised {type(error).__name__}"]
        if failures:
            continue

        # The budget from problem 510, now spent on a real ciphertext: the largest tolerated
        # noise still returns the message and one step past it does not.
        low, high = reference_interval(par)
        case = lwe_case(par, seed, label, 7)
        secret, message = case["secret"], case["message"]
        for noise, ought in ((high, True), (low, True), (high + 1, False), (low - 1, False)):
            ciphertext = reference_lwe_encrypt(par, secret, message, case["mask"], noise)
            if (module.lwe_decrypt(par, secret, ciphertext) == message) is not ought:
                failures.append(
                    "a tolerated noise value broke the round trip"
                    if ought
                    else "noise past the boundary still decrypted to the message"
                )
                break
    return failures


def check_rlwe(module, seed: str) -> list[str]:
    """The same three terms, one dimension up."""
    failures: list[str] = []
    for label, par in _sets(seed):
        n, q = par["degree"], par["q"]
        for index in range(3):
            case = rlwe_case(par, seed, label, index)
            secret, message = case["secret"], case["message"]
            try:
                produced = module.rlwe_encrypt(par, secret, message, case["mask"], case["error"])
            except Exception as error:  # noqa: BLE001
                return [f"RLWE encryption raised {type(error).__name__}"]
            expected = reference_rlwe_encrypt(par, secret, message, case["mask"], case["error"])
            if (_tuple(produced[0]), _tuple(produced[1])) != expected:
                failures.append("an RLWE ciphertext is not a*s + encode(m) + e in the ring")
                break
            if any(len(_tuple(part)) != n for part in produced):
                failures.append("an RLWE ciphertext is not a pair of ring elements")
                break
            if any(not 0 <= value < q for part in produced for value in _tuple(part)):
                failures.append("an RLWE ciphertext leaves this function non-canonical")
                break
            try:
                if _tuple(module.rlwe_phase(par, secret, expected)) != reference_rlwe_phase(
                    par, secret, expected
                ):
                    failures.append("the RLWE phase does not cancel the secret out of the body")
                    break
                if _tuple(module.rlwe_decrypt(par, secret, expected)) != tuple(message):
                    failures.append("an RLWE round trip does not return every message")
                    break
            except Exception as error:  # noqa: BLE001
                return [f"RLWE decryption raised {type(error).__name__}"]
        if failures:
            continue

        # Every coefficient carries its own message and spends its own budget: push one
        # coefficient past the boundary and exactly that one changes.
        low, high = reference_interval(par)
        case = rlwe_case(par, seed, label, 7)
        secret, message = case["secret"], case["message"]
        for position in (0, n - 1):
            error = tuple(high + 1 if i == position else 0 for i in range(n))
            ciphertext = reference_rlwe_encrypt(par, secret, message, case["mask"], error)
            decrypted = _tuple(module.rlwe_decrypt(par, secret, ciphertext))
            if len(decrypted) != n:
                failures.append("RLWE decryption does not return N messages")
                break
            differs = [i for i in range(n) if decrypted[i] != message[i]]
            if differs != [position]:
                failures.append(
                    "noise on one coefficient did not lose exactly that coefficient's message"
                )
                break
        if failures:
            continue
        for position in (0, n - 1):
            error = tuple(low if i == position else high for i in range(n))
            ciphertext = reference_rlwe_encrypt(par, secret, message, case["mask"], error)
            if _tuple(module.rlwe_decrypt(par, secret, ciphertext)) != tuple(message):
                failures.append("noise at the edges of the budget lost a message")
                break
    return failures


def check_correspondence(module, seed: str) -> list[str]:
    """One RLWE ciphertext is N LWE-shaped equations sharing a mask.

    Both sides of the identity come from the fixtures. Checking `<v, s>` against the
    submission's own `ring_mul` would accept a wrong vector and a wrong product together,
    which is the failure this split exists to prevent.
    """
    failures: list[str] = []
    for label, par in _sets(seed):
        n, q = par["degree"], par["q"]
        for index in range(2):
            mask = raw_sequence(seed, f"{label}:terms:{index}", n, 0, q - 1)
            try:
                produced = [_tuple(module.phase_coefficient_terms(par, mask, k)) for k in range(n)]
            except Exception as error:  # noqa: BLE001
                return [f"building the coefficient vector raised {type(error).__name__}"]
            if produced != [reference_terms(par, mask, k) for k in range(n)]:
                failures.append("the coefficient vector is not the one the product uses")
                break

            # The identity itself, over the basis (which pins every entry) and over real
            # ternary secrets (which is the shape it will meet).
            secrets = [tuple(1 if i == j else 0 for i in range(n)) for j in range(n)]
            secrets.extend(
                reference_secret(seed, f"{label}:terms:{index}:{trial}", n) for trial in range(4)
            )
            for s in secrets:
                product = reference_ring_mul(par, mask, s)
                for k in range(n):
                    if sum(a * b for a, b in zip(produced[k], s)) % q != product[k]:
                        failures.append(
                            "<v, s> does not equal coefficient k of the product for every secret"
                        )
                        break
                if failures:
                    break
            if failures:
                break
    return failures


def check_boundary(module, seed: str) -> list[str]:
    """One number's budget, spent N at a time."""
    failures: list[str] = []
    for label, par in _sets(seed):
        n = par["degree"]
        low, high = reference_interval(par)
        try:
            scalars = [
                (low, True),
                (high, True),
                (0, True),
                (low - 1, False),
                (high + 1, False),
                (2 * par["q"], False),
            ]
            for value, ought in scalars:
                if module.survives(par, value) is not ought:
                    failures.append("a scalar noise value is on the wrong side of the budget")
                    break
        except Exception as error:  # noqa: BLE001
            return [f"deciding survival raised {type(error).__name__}"]
        if failures:
            continue

        vectors = [
            (tuple(0 for _ in range(n)), True),
            (tuple(high for _ in range(n)), True),
            (tuple(low for _ in range(n)), True),
            # Comfortable on average, one coefficient over the edge. Anything that scores a
            # polynomial by its sum, its mean, or its magnitude reports this as surviving.
            (tuple(high + 1 if i == 0 else low for i in range(n)), False),
            (tuple(low - 1 if i == n - 1 else high for i in range(n)), False),
            (tuple(high + 1 for _ in range(n)), False),
        ]
        for value, ought in vectors:
            if module.survives(par, value) is not ought:
                failures.append(
                    "a polynomial survives when every coefficient does, and only then"
                )
                break
        if failures:
            continue

        try:
            samples = boundary_samples(par, seed, label)
            if module.first_failing_index(par, samples) != reference_first_failing_index(
                par, samples
            ):
                failures.append("the first failing sample is not the first one")
                continue
            clean = surviving_samples(par, seed, label)
            if module.first_failing_index(par, clean) != -1:
                failures.append("a run with no failure in it did not report -1")
                continue
            if module.first_failing_index(par, ()) != -1:
                failures.append("an empty run did not report -1")
                continue
        except Exception as error:  # noqa: BLE001
            return [f"searching for the first failure raised {type(error).__name__}"]
    return failures


def check_validate(module, seed: str) -> list[str]:
    """Objects that cannot be ciphertexts, and the ones that can.

    The rejects are fixed in the fixtures rather than built by the learner: rejecting an
    object you broke yourself proves nothing about the validator.
    """
    failures: list[str] = []
    for _label, par in _sets(seed):
        try:
            for reason, mode, ciphertext in invalid_ciphertexts(par):
                if not module.validate_ciphertext(par, mode, ciphertext):
                    failures.append(f"an unusable ciphertext was accepted: {reason}")
            for mode, ciphertext in valid_ciphertexts(par):
                if module.validate_ciphertext(par, mode, ciphertext):
                    failures.append("a well-formed ciphertext was rejected")
        except Exception as error:  # noqa: BLE001
            return [f"validating a ciphertext raised {type(error).__name__}"]
        if failures:
            continue

        # A ciphertext this problem produced is well-formed by construction, so rejecting
        # one is a false positive rather than caution.
        case = lwe_case(par, seed, "validate", 0)
        lwe = reference_lwe_encrypt(
            par, case["secret"], case["message"], case["mask"], case["error"]
        )
        rcase = rlwe_case(par, seed, "validate", 0)
        rlwe = reference_rlwe_encrypt(
            par, rcase["secret"], rcase["message"], rcase["mask"], rcase["error"]
        )
        if module.validate_ciphertext(par, "lwe", lwe) or module.validate_ciphertext(
            par, "rlwe", rlwe
        ):
            failures.append("a ciphertext this problem produced was rejected")
            continue

        # The two shapes are not interchangeable, whatever their lengths happen to be.
        if not module.validate_ciphertext(par, "rlwe", lwe):
            failures.append("an LWE ciphertext was accepted as an RLWE one")
            continue

        # Deterministic, and a list of strings rather than a bool or None.
        _reason, mode, sample = invalid_ciphertexts(par)[0]
        first = module.validate_ciphertext(par, mode, sample)
        if not isinstance(first, list) or not all(isinstance(item, str) for item in first):
            failures.append("validation does not report a list of strings")
        elif first != module.validate_ciphertext(par, mode, sample):
            failures.append("validation is not deterministic")
    return failures


def check_transfer(module, seed: str) -> list[str]:
    """Everything at once, under parameters the learner has not seen.

    /verify passes a derived seed for this checkpoint, so these rings, dimensions, secrets
    and cases are not the ones any other checkpoint used.
    """
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures


PHASES = (
    check_normalize,
    check_ring,
    check_lwe,
    check_rlwe,
    check_correspondence,
    check_boundary,
    check_validate,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
