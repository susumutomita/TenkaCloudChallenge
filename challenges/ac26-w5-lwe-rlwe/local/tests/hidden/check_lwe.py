"""Hidden tests. Run by /verify against a copy of the learner's lwe.py.

Ground truth comes from `fixtures.generate`, never from the submission. That matters most
for the round-trips: a checker that encrypted with the submission and decrypted with the
submission passes any pair of functions that are each other's inverse, including a pair
that never touches the secret. So every round-trip below is also run **crossed** --
encrypt with the reference and decrypt with the submission, and the other way round.

Every phase runs across several parameter sets, and `params` varies the degree, the
dimension, the plaintext modulus, and delta together. A submission that hardcodes any one
of them fails a subset rather than everything, which is the point.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    boundary_samples,
    centered as reference_centered,
    cyclic_mul,
    first_boundary_crossing,
    lwe_decrypt as reference_lwe_decrypt,
    lwe_encrypt as reference_lwe_encrypt,
    lwe_mask,
    lwe_secret,
    malformed,
    normalize as reference_normalize,
    params as parameters,
    ring_add as reference_ring_add,
    ring_mul as reference_ring_mul,
    ring_sub as reference_ring_sub,
    rlwe_decrypt as reference_rlwe_decrypt,
    rlwe_encrypt as reference_rlwe_encrypt,
    rlwe_mask,
    rlwe_secret,
    small_noise,
    success_interval,
    wellformed,
)

LABELS = ("h0", "h1", "h2", "h3", "h4")


def _sets(seed: str) -> list[dict]:
    """Parameter sets covering every degree the generator can draw.

    Without the top-up a seed that happened to draw N = 2 five times would never exercise
    the negacyclic wrap at all, since with N = 2 almost every product wraps and the sign
    error is hard to miss for the wrong reason.
    """
    drawn = [parameters(seed, label) for label in LABELS]
    for degree in (2, 4, 8):
        if not any(par["degree"] == degree for par in drawn):
            topped = dict(drawn[0])
            topped["degree"] = degree
            drawn.append(topped)
    return drawn


def check_normalize(module, seed: str) -> list[str]:
    """Folding to degree < N with X^N = -1, and reducing into [0, q)."""
    failures: list[str] = []
    for par in _sets(seed):
        n, q = par["degree"], par["modulus"]
        cases = [
            [0] * n,
            list(range(3 * n)),
            [-1] * (2 * n),
            [q, q + 1, -q - 1] + [0] * n,
            [5],
            [],
        ]
        for raw in cases:
            try:
                got = module.normalize(par, list(raw))
            except Exception as error:  # noqa: BLE001
                return [f"normalizing raised {type(error).__name__}"]
            want = reference_normalize(par, raw)
            if tuple(got) != want:
                if len(tuple(got)) != n:
                    failures.append("normalizing does not produce exactly N coefficients")
                elif any(not 0 <= value < q for value in got):
                    failures.append("a normalized coefficient is outside [0, q)")
                else:
                    failures.append("the degree fold does not follow X^N = -1")
                break
        if failures:
            break

        # Idempotence, and the relation itself: X^(N-1) * X must be -1.
        once = module.normalize(par, list(range(3 * n)))
        if tuple(module.normalize(par, list(once))) != tuple(once):
            failures.append("normalizing twice is not the same as normalizing once")
            continue
        # A coefficient two wraps out comes back with its sign restored.
        if tuple(module.normalize(par, [0] * (2 * n) + [1])) != reference_normalize(
            par, [0] * (2 * n) + [1]
        ):
            failures.append("two wraps do not restore the sign")
    return failures


def check_ring(module, seed: str) -> list[str]:
    """Addition, subtraction, and the negacyclic product."""
    failures: list[str] = []
    for par in _sets(seed):
        n = par["degree"]
        a = rlwe_mask(seed, par, "ring-a")[:n]
        b = rlwe_mask(seed, par, "ring-b")[:n]
        c = rlwe_mask(seed, par, "ring-c")[:n]
        try:
            got_mul = tuple(module.ring_mul(par, a, b))
        except Exception as error:  # noqa: BLE001
            return [f"a ring operation raised {type(error).__name__}"]

        if tuple(module.ring_add(par, a, b)) != reference_ring_add(par, a, b):
            failures.append("ring addition does not match the ring")
            continue
        if tuple(module.ring_sub(par, a, b)) != reference_ring_sub(par, a, b):
            failures.append("ring subtraction does not match the ring")
            continue
        if got_mul != reference_ring_mul(par, a, b):
            # The named case first, because it is the one a learner actually writes.
            if got_mul == cyclic_mul(par, a, b):
                failures.append("the product is cyclic: it uses X^N = +1 rather than -1")
            else:
                failures.append("the ring product is wrong")
            continue

        # X^N = -1, stated directly rather than inferred from a product table.
        top = tuple([0] * (n - 1) + [1])
        x = tuple([0, 1] + [0] * (n - 2)) if n > 1 else (1,)
        if tuple(module.ring_mul(par, top, x)) != reference_normalize(par, [-1] + [0] * (n - 1)):
            failures.append("X^(N-1) * X is not -1")
            continue

        # Distributivity and commutativity, which a sign error can still satisfy -- they
        # are here to catch an implementation that is wrong in a way the fixed vectors
        # above happened to miss.
        if tuple(module.ring_mul(par, a, module.ring_add(par, b, c))) != reference_ring_add(
            par, reference_ring_mul(par, a, b), reference_ring_mul(par, a, c)
        ):
            failures.append("the product does not distribute over addition")
            continue
        if tuple(module.ring_mul(par, a, b)) != tuple(module.ring_mul(par, b, a)):
            failures.append("the product is not commutative")
    return failures


def check_lwe(module, seed: str) -> list[str]:
    """The LWE round trip, crossed against the reference in both directions."""
    failures: list[str] = []
    for par in _sets(seed):
        secret = lwe_secret(seed, par)
        for index in range(3):
            mask = lwe_mask(seed, par, f"lwe:{index}")
            noise = small_noise(seed, par, f"lwe:{index}", 1)[0]
            for message in range(par["plaintext_modulus"]):
                try:
                    mine = module.lwe_encrypt(par, secret, message, mask, noise)
                except Exception as error:  # noqa: BLE001
                    return [f"LWE encryption raised {type(error).__name__}"]
                theirs = reference_lwe_encrypt(par, secret, message, mask, noise)

                if tuple(mine.get("a", ())) != theirs["a"] or mine.get("b") != theirs["b"]:
                    failures.append("the LWE ciphertext is not <a, s> + encode(m) + e")
                    return failures
                # A ciphertext carries a and b, and nothing that would make decryption
                # unnecessary.
                if set(mine) != {"a", "b"}:
                    failures.append("the LWE ciphertext carries fields beyond a and b")
                    return failures

                # Crossed both ways: neither side gets to define the other.
                for ciphertext in (mine, theirs):
                    result = module.lwe_decrypt(par, secret, ciphertext)
                    if result["message"] != message:
                        failures.append("an LWE ciphertext within the noise budget did not decrypt")
                        return failures
                    if result["noise"] != noise:
                        failures.append("the reported LWE noise is not the noise that was added")
                        return failures
                    if result["phase"] != reference_lwe_decrypt(par, secret, ciphertext)["phase"]:
                        failures.append("the LWE phase is not b - <a, s>")
                        return failures
                    if result["centered_phase"] != reference_centered(par, result["phase"]):
                        failures.append("the centered phase does not match the phase")
                        return failures
                if reference_lwe_decrypt(par, secret, mine)["message"] != message:
                    failures.append("the reference could not decrypt the submitted ciphertext")
                    return failures

        # Different masks, same plaintext, different ciphertexts. A submission that
        # ignores the mask round-trips perfectly and fails here.
        first = module.lwe_encrypt(par, secret, 0, lwe_mask(seed, par, "r0"), 0)
        second = module.lwe_encrypt(par, secret, 0, lwe_mask(seed, par, "r1"), 0)
        if first == second:
            failures.append("two different masks produced the same LWE ciphertext")
    return failures


def check_rlwe(module, seed: str) -> list[str]:
    """The RLWE round trip, crossed the same way."""
    failures: list[str] = []
    for par in _sets(seed):
        n, p = par["degree"], par["plaintext_modulus"]
        secret = rlwe_secret(seed, par)
        for index in range(3):
            mask = rlwe_mask(seed, par, f"rlwe:{index}")
            noise = small_noise(seed, par, f"rlwe:{index}", n)
            messages = tuple((index + position) % p for position in range(n))
            try:
                mine = module.rlwe_encrypt(par, secret, messages, mask, noise)
            except Exception as error:  # noqa: BLE001
                return [f"RLWE encryption raised {type(error).__name__}"]
            theirs = reference_rlwe_encrypt(par, secret, messages, mask, noise)

            if tuple(mine.get("a", ())) != theirs["a"] or tuple(mine.get("b", ())) != theirs["b"]:
                failures.append("the RLWE ciphertext is not A * S + encode(M) + E")
                return failures
            if set(mine) != {"a", "b"}:
                failures.append("the RLWE ciphertext carries fields beyond a and b")
                return failures

            for ciphertext in (mine, theirs):
                result = module.rlwe_decrypt(par, secret, ciphertext)
                if tuple(result["message"]) != messages:
                    failures.append("an RLWE ciphertext within the noise budget did not decrypt")
                    return failures
                if tuple(result["noise"]) != tuple(noise):
                    failures.append("the reported RLWE noise is not the noise that was added")
                    return failures
                if tuple(result["phase"]) != reference_rlwe_decrypt(par, secret, ciphertext)["phase"]:
                    failures.append("the RLWE phase is not B - A * S")
                    return failures
            if tuple(reference_rlwe_decrypt(par, secret, mine)["message"]) != messages:
                failures.append("the reference could not decrypt the submitted ciphertext")
                return failures

        # One ciphertext, N messages. A submission that only ever gets coefficient 0 right
        # -- the one an LWE-shaped mental model would care about -- fails here.
        mask = rlwe_mask(seed, par, "payload")
        messages = tuple((position + 1) % p for position in range(n))
        ciphertext = module.rlwe_encrypt(par, secret, messages, mask, [0] * n)
        if tuple(module.rlwe_decrypt(par, secret, ciphertext)["message"]) != messages:
            failures.append("only some of the N coefficients survived the round trip")
    return failures


def check_correspondence(module, seed: str) -> list[str]:
    """The structured side-by-side, and the labels that name what actually differs."""
    failures: list[str] = []
    for par in _sets(seed):
        n = par["degree"]
        lwe = {
            "secret": lwe_secret(seed, par),
            "ciphertext": reference_lwe_encrypt(
                par, lwe_secret(seed, par), 1 % par["plaintext_modulus"],
                lwe_mask(seed, par, "corr"), small_noise(seed, par, "corr", 1)[0],
            ),
        }
        rlwe_messages = tuple((position + 1) % par["plaintext_modulus"] for position in range(n))
        rlwe = {
            "secret": rlwe_secret(seed, par),
            "ciphertext": reference_rlwe_encrypt(
                par, rlwe_secret(seed, par), rlwe_messages,
                rlwe_mask(seed, par, "corr"), small_noise(seed, par, "corr", n),
            ),
        }
        try:
            got = module.correspondence(par, lwe, rlwe)
        except Exception as error:  # noqa: BLE001
            return [f"building the correspondence raised {type(error).__name__}"]
        if not isinstance(got, dict) or {"lwe", "rlwe"} - set(got):
            failures.append("the correspondence does not describe both schemes")
            continue

        want_lwe = reference_lwe_decrypt(par, lwe["secret"], lwe["ciphertext"])
        want_rlwe = reference_rlwe_decrypt(par, rlwe["secret"], rlwe["ciphertext"])

        if got["lwe"].get("operation") != "inner-product":
            failures.append("the LWE operation is not named as an inner product")
            continue
        if got["rlwe"].get("operation") != "negacyclic-product":
            # Calling it an inner product is `rlwe-is-longer-lwe` written down.
            failures.append("the RLWE operation is not named as a negacyclic product")
            continue
        if got["lwe"].get("secret_kind") != "vector" or got["rlwe"].get("secret_kind") != "polynomial":
            failures.append("the two secrets are not distinguished by shape")
            continue
        # One LWE ciphertext carries one message; one RLWE ciphertext carries N.
        if got["lwe"].get("payload_size") != 1 or got["rlwe"].get("payload_size") != n:
            failures.append("the payload sizes do not reflect that RLWE carries N messages")
            continue

        if got["lwe"].get("phase") != want_lwe["phase"]:
            failures.append("the LWE phase in the correspondence is wrong")
            continue
        if tuple(got["rlwe"].get("phase", ())) != want_rlwe["phase"]:
            failures.append("the RLWE phase in the correspondence is wrong")
            continue
        if got["lwe"].get("message") != want_lwe["message"]:
            failures.append("the LWE message in the correspondence is wrong")
            continue
        if tuple(got["rlwe"].get("message", ())) != want_rlwe["message"]:
            failures.append("the RLWE message in the correspondence is wrong")
            continue
        if got["lwe"].get("centered_phase") != want_lwe["centered_phase"]:
            failures.append("the LWE centered phase in the correspondence is wrong")
            continue
        if tuple(got["rlwe"].get("centered_phase", ())) != want_rlwe["centered_phase"]:
            failures.append("the RLWE centered phase in the correspondence is wrong")
    return failures


def check_boundary(module, seed: str) -> list[str]:
    """Predicting which samples survive, and finding the first that does not."""
    failures: list[str] = []
    for par in _sets(seed):
        low, high = success_interval(par)
        try:
            predicted = [module.survives(par, noise) for noise in range(low - 3, high + 4)]
        except Exception as error:  # noqa: BLE001
            return [f"predicting survival raised {type(error).__name__}"]
        expected = [low <= noise <= high for noise in range(low - 3, high + 4)]
        if predicted != expected:
            if [low <= noise <= -low for noise in range(low - 3, high + 4)] == predicted:
                failures.append("the noise budget is symmetric, but the tie rule is not")
            else:
                failures.append("the predicted noise budget is not the tolerated one")
            continue

    samples = boundary_samples(seed, parameters(seed))
    par = parameters(seed)
    try:
        crossing = module.first_crossing(par, list(samples))
    except Exception as error:  # noqa: BLE001
        return [f"searching for the first crossing raised {type(error).__name__}"]
    if crossing != first_boundary_crossing(seed, par):
        failures.append("the first sample out of budget is not the one reported")
        return failures

    # In the given order, not sorted by magnitude. This list puts the FURTHEST-out noise
    # first, so a search that sorts by |noise| answers 1 where the given order answers 0.
    low, high = success_interval(par)
    probe = [
        {"index": 0, "noise": low - 5},
        {"index": 1, "noise": high + 1},
        {"index": 2, "noise": 0},
    ]
    if module.first_crossing(par, probe) != 0:
        failures.append("the search does not respect the order it was given")
    # And every sample surviving means there is no crossing to report.
    surviving = [sample for sample in samples if sample["decodes"]]
    if surviving and module.first_crossing(par, surviving) != -1:
        failures.append("a run with no sample out of budget still reported a crossing")
    return failures


def check_transfer(module, seed: str) -> list[str]:
    """All of it, under a degree, modulus, dimension and secret not seen elsewhere."""
    failures: list[str] = []
    for phase in (
        check_normalize,
        check_ring,
        check_lwe,
        check_rlwe,
        check_correspondence,
        check_boundary,
    ):
        failures.extend(phase(module, seed))
    return failures


def check_defense(module, seed: str) -> list[str]:
    """Malformed ciphertexts rejected, well-formed ones not."""
    failures: list[str] = []
    for par in _sets(seed):
        try:
            for kind, reason, ciphertext in malformed(par):
                if not module.validate_ciphertext(par, kind, dict(ciphertext)):
                    failures.append(f"a malformed {kind} ciphertext was accepted: {reason}")
            for kind, ciphertext in wellformed(seed, par):
                if module.validate_ciphertext(par, kind, dict(ciphertext)):
                    failures.append(f"a well-formed {kind} ciphertext was rejected")
        except Exception as error:  # noqa: BLE001
            return [f"validating a ciphertext raised {type(error).__name__}"]

        # Deterministic, and a list of strings rather than a bool.
        kind, _, sample = malformed(par)[0]
        first = module.validate_ciphertext(par, kind, dict(sample))
        if not isinstance(first, list) or not all(isinstance(item, str) for item in first):
            failures.append("validation does not report a list of strings")
        elif first != module.validate_ciphertext(par, kind, dict(sample)):
            failures.append("validation is not deterministic")

        # An LWE ciphertext is not an RLWE one. A validator that ignores `kind` accepts a
        # dimension-length mask as a degree-length polynomial whenever the two happen to
        # match, and this asserts they are checked against the right one.
        if par["dimension"] != par["degree"]:
            crossed = {"a": tuple([0] * par["dimension"]), "b": tuple([0] * par["degree"])}
            if not module.validate_ciphertext(par, "rlwe", crossed):
                failures.append("an LWE-shaped mask was accepted as an RLWE polynomial")
    return failures


PHASES = (
    check_normalize,
    check_ring,
    check_lwe,
    check_rlwe,
    check_correspondence,
    check_boundary,
    check_defense,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
