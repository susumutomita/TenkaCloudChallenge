"""Hidden tests. Run by /verify against a copy of the learner's cmux.py.

Ground truth is `fixtures.generate`, never the submission. That matters most for the loop: a
checker that rotated with the submission and compared against a model built out of the same
rotation would pass any direction convention, as long as it was wrong consistently. So
`check_blind` compares against `reference_model`, which computes the answer in the clear
from the phase and never calls anything the learner wrote.

Every phase runs across several parameter sets. `params` varies the base, the level count,
the degree and the LWE dimension together, so an implementation that hardcodes any one of
them fails a subset rather than everything.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    blind_rotate as reference_blind_rotate,
    blind_rotate_trace as reference_trace,
    bootstrap_key,
    decode,
    digest,
    encode,
    lwe_sample,
    lwe_secret,
    monomial_rotate as reference_rotate,
    params as parameters,
    reference_model,
    rgsw_encrypt,
    rgsw_material,
    ring_noise,
    ring_random,
    rlwe_add as reference_add,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_secret,
    rlwe_sub as reference_sub,
    rlwe_trivial,
    rotate_ciphertext as reference_rotate_ciphertext,
    test_vector,
)

LABELS = ("h0", "h1", "h2", "h3")


def _sets(seed: str) -> list[dict]:
    """Parameter sets covering both bases the generator can draw.

    Without the top-up a seed that drew base 2 every time would never exercise a base whose
    digits exceed one bit, and a seed that drew degree 2 every time would never exercise a
    ring where a rotation can wrap more than once.
    """
    drawn = [parameters(seed, label) for label in LABELS]
    for base in (2, 4):
        if not any(par["base"] == base for par in drawn):
            drawn.append(_forced(base))
    if not any(par["degree"] >= 4 for par in drawn):
        drawn.append(_forced(2, minimum_degree=4))
    return drawn


def _forced(base: int, minimum_degree: int = 0) -> dict:
    """A viable set with the given base, for when the seed did not draw one."""
    from fixtures.generate import VIABLE

    levels, degree, dimension = next(
        (l, d, n) for b, l, d, n in VIABLE if b == base and d >= minimum_degree
    )
    modulus = base**levels
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "modulus": modulus,
        "plaintext_modulus": 4,
        "delta": modulus // 4,
    }


def _pair(seed: str, par: dict, label: str) -> tuple:
    """A ring secret and two ciphertexts whose messages differ in every coefficient."""
    secret = rlwe_secret(seed, par, label)
    m0 = tuple((index + 1) % par["plaintext_modulus"] for index in range(par["degree"]))
    m1 = tuple((value + 2) % par["plaintext_modulus"] for value in m0)
    ciphertexts = tuple(
        rlwe_encrypt(
            par,
            secret,
            messages,
            ring_random(seed, par, f"{label}:{which}"),
            ring_noise(seed, par, f"{label}:{which}"),
        )
        for which, messages in enumerate((m0, m1))
    )
    return secret, (m0, m1), ciphertexts


def _bootstrap(seed: str, par: dict, label: str) -> tuple:
    """Everything a blind rotation consumes: ring secret, LWE bits, key, sample, accumulator."""
    ring_secret = rlwe_secret(seed, par, f"{label}:ring")
    bits = lwe_secret(seed, par, label)
    key = bootstrap_key(seed, par, ring_secret, bits, label)
    sample = lwe_sample(seed, par, bits, label)
    plaintext = test_vector(seed, par, label)
    return ring_secret, bits, key, sample, plaintext, rlwe_trivial(par, plaintext)


def _unreduced(sample: dict) -> dict:
    """The same LWE sample, handed over with representatives outside `[0, 2N)`.

    Adding a multiple of `2N` to a mask coefficient or to the body changes nothing: the
    phase moves by a multiple of the modulus, and `X^(2N) = 1` so every rotation is
    identical. A blind rotation that assumes its inputs arrive already reduced disagrees,
    and a trace that reports the raw coefficient as the exponent disagrees too.
    """
    modulus = sample["modulus"]
    mask = tuple(
        value + modulus * (index + 1 if index % 2 == 0 else -(index + 1))
        for index, value in enumerate(sample["mask"])
    )
    return {"mask": mask, "body": sample["body"] + 3 * modulus, "modulus": modulus}


def _as_ciphertext(value: object) -> dict:
    """Normalize a submission's `{"a": ..., "b": ...}` into comparable tuples."""
    if not isinstance(value, dict) or "a" not in value or "b" not in value:
        raise TypeError("not a ciphertext")
    return {"a": tuple(value["a"]), "b": tuple(value["b"])}


# ---------------------------------------------------------------------------
# 1. Adding and subtracting ciphertexts
# ---------------------------------------------------------------------------


def check_combine(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        _, _, (ct0, ct1) = _pair(seed, par, "combine")
        try:
            got_add = _as_ciphertext(module.rlwe_add(par, ct0, ct1))
            got_sub = _as_ciphertext(module.rlwe_sub(par, ct1, ct0))
        except Exception as error:  # noqa: BLE001
            return [f"combining two ciphertexts raised {type(error).__name__}"]

        if got_add != reference_add(par, ct0, ct1):
            if got_add["b"] == reference_add(par, ct0, ct1)["b"]:
                failures.append("the sum's `a` half was not added")
            else:
                failures.append("adding two ciphertexts does not add both halves")
            continue
        if got_sub != reference_sub(par, ct1, ct0):
            if got_sub == reference_sub(par, ct0, ct1):
                failures.append("the difference is the other way round")
            elif got_sub["b"] == reference_sub(par, ct1, ct0)["b"]:
                failures.append("the difference's `a` half was not subtracted")
            else:
                failures.append("subtracting two ciphertexts does not subtract both halves")
            continue

        # A ciphertext handed a shorter or longer coefficient list still has to come back
        # as a ring element -- the rotations later on produce exactly that.
        ragged = {"a": ct0["a"][:1], "b": ct0["b"]}
        try:
            padded = _as_ciphertext(module.rlwe_add(par, ragged, ct1))
        except Exception as error:  # noqa: BLE001
            failures.append(f"a short coefficient list raised {type(error).__name__}")
            continue
        if padded != reference_add(par, ragged, ct1):
            failures.append("a short coefficient list is not padded to the ring degree")
    return failures


# ---------------------------------------------------------------------------
# 2. CMUX
# ---------------------------------------------------------------------------


def check_cmux(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        secret, (m0, m1), (ct0, ct1) = _pair(seed, par, "cmux")
        for selector in (0, 1):
            rgsw = rgsw_encrypt(
                par, secret, selector, rgsw_material(seed, par, f"cmux:{selector}")
            )
            try:
                got = _as_ciphertext(module.cmux(par, rgsw, ct0, ct1))
            except Exception as error:  # noqa: BLE001
                return [f"the CMUX raised {type(error).__name__}"]
            want = m0 if selector == 0 else m1
            if rlwe_decrypt(par, secret, got) != want:
                other = m1 if selector == 0 else m0
                if rlwe_decrypt(par, secret, got) == other:
                    failures.append(f"selector {selector} returned the other branch")
                else:
                    failures.append(
                        f"selector {selector} did not decrypt to the branch it selects"
                    )
                return failures

        # Rerandomization: a different bootstrapping-key row for the same bit is a different
        # ciphertext, and the selected branch has to be unchanged by that.
        for selector in (0, 1):
            first = _as_ciphertext(
                module.cmux(
                    par,
                    rgsw_encrypt(par, secret, selector, rgsw_material(seed, par, f"re:{selector}:x")),
                    ct0,
                    ct1,
                )
            )
            second = _as_ciphertext(
                module.cmux(
                    par,
                    rgsw_encrypt(par, secret, selector, rgsw_material(seed, par, f"re:{selector}:y")),
                    ct0,
                    ct1,
                )
            )
            if first == second:
                failures.append("re-encrypting the selector did not change the ciphertext")
                return failures
            if rlwe_decrypt(par, secret, first) != rlwe_decrypt(par, secret, second):
                failures.append("re-encrypting the selector changed the selected branch")
                return failures
    return failures


# ---------------------------------------------------------------------------
# 3. The constant-path audit
# ---------------------------------------------------------------------------


class _Recorder(tuple):
    """An RGSW that records which rows were read, in order.

    Used to compare one run against another rather than to police a style: two runs whose
    only difference is the encrypted bit have to read the same rows in the same order, and
    an implementation that never reads the key at all reads none of them.
    """

    def __new__(cls, rows, log: list) -> "_Recorder":
        instance = super().__new__(cls, rows)
        instance.log = log  # noqa: SLF001 - the whole purpose of the subclass
        return instance

    def __getitem__(self, index):
        self.log.append(index)
        return tuple.__getitem__(self, index)

    def __iter__(self):
        for index in range(len(self)):
            yield self[index]


#: Names a submission would reach for to learn a plaintext. It cannot succeed -- it is given
#: no secret -- but an attempt is still worth failing, because it means the author has not
#: understood what the construction is for.
_FORBIDDEN = ("rlwe_decrypt", "rlwe_phase", "decode", "centered", "lwe_phase")


def _with_tripwires(module, body):
    """Run `body()` with every decryption helper replaced by one that records the attempt."""
    import fixtures.generate as supplied

    attempts: list[str] = []
    saved = []
    for name in _FORBIDDEN:

        def tripwire(*_args: object, _name: str = name, **_kwargs: object) -> object:
            attempts.append(_name)
            return 0

        for target in (module, supplied):
            saved.append((target, name, getattr(target, name, None), hasattr(target, name)))
            setattr(target, name, tripwire)
    try:
        result = body()
    finally:
        for target, name, previous, existed in reversed(saved):
            if existed:
                setattr(target, name, previous)
            else:
                delattr(target, name)
    return result, attempts


def check_constant(module, seed: str) -> list[str]:
    """That the selection was performed arithmetically, not chosen in the clear.

    This is an audit, not a proof: it cannot show a submission is constant-time, and it does
    not try to. What it does show is that both branches were computed, that the whole key was
    consumed, and that the output is a ciphertext neither input could have supplied -- which
    is what separates arithmetic selection from an `if`.
    """
    failures: list[str] = []
    for par in _sets(seed):
        secret, _, (ct0, ct1) = _pair(seed, par, "constant")
        material = rgsw_material(seed, par, "constant")

        traces = []
        for selector in (0, 1):
            log: list = []
            rows = _Recorder(rgsw_encrypt(par, secret, selector, material), log)
            try:
                got = _as_ciphertext(module.cmux(par, rows, ct0, ct1))
            except Exception as error:  # noqa: BLE001
                return [f"the CMUX raised {type(error).__name__} on an instrumented key"]
            traces.append(log)

            # A branch taken in the clear returns one of its inputs. A CMUX cannot: the
            # external product contributes fresh noise on both paths.
            if got == _as_ciphertext(ct0) or got == _as_ciphertext(ct1):
                failures.append("the CMUX returned one of its inputs unchanged")
                return failures

        rows_read = {index for index in traces[0] if isinstance(index, int)}
        if rows_read != set(range(2 * par["levels"])):
            failures.append("the CMUX did not read every row of the selector ciphertext")
            return failures
        if traces[0] != traces[1]:
            failures.append("the two selectors read the selector ciphertext differently")
            return failures

        # Identical branches: whatever the bit is, the plaintext is the one both sides carry.
        # Note that the ciphertext *is* `ct0` here, exactly, and that is not a branch taken
        # in the clear -- `ct1 - ct0` is zero, zero decomposes to zero digits, and the
        # external product of zero digits is the zero ciphertext. The degenerate case is
        # degenerate arithmetically, which is why the check above uses two distinct branches.
        for selector in (0, 1):
            rgsw = rgsw_encrypt(par, secret, selector, rgsw_material(seed, par, f"same:{selector}"))
            same = _as_ciphertext(module.cmux(par, rgsw, ct0, ct0))
            if rlwe_decrypt(par, secret, same) != rlwe_decrypt(par, secret, ct0):
                failures.append("identical branches did not produce that branch's plaintext")
                return failures

        # And nothing reached for a decryption helper along the way.
        _, _, key, sample, _, accumulator = _bootstrap(seed, par, "constant")
        rgsw = rgsw_encrypt(par, secret, 1, rgsw_material(seed, par, "tripwire"))

        def exercise() -> None:
            module.cmux(par, rgsw, ct0, ct1)
            module.blind_rotate(par, key, sample, accumulator)

        try:
            _, attempts = _with_tripwires(module, exercise)
        except Exception as error:  # noqa: BLE001
            return [f"running under instrumentation raised {type(error).__name__}"]
        if attempts:
            failures.append(f"the submission called {attempts[0]}, which needs a secret it is not given")
            return failures
    return failures


# ---------------------------------------------------------------------------
# 4. Monomial rotation
# ---------------------------------------------------------------------------


def check_rotate(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        degree = par["degree"]
        poly = ring_random(seed, par, "rotate")
        exponents = [0, 1, degree - 1, degree, degree + 1, 2 * degree, 2 * degree + 1, -1, -degree, -(2 * degree + 3), 5 * degree]
        try:
            got = [tuple(module.monomial_rotate(par, poly, k)) for k in exponents]
        except Exception as error:  # noqa: BLE001
            return [f"rotating a polynomial raised {type(error).__name__}"]
        want = [reference_rotate(par, poly, k) for k in exponents]
        if got != want:
            if all(len(value) == degree for value in got) and got[exponents.index(degree)] == poly:
                failures.append("wrapping past the degree does not negate the coefficients")
            elif any(len(value) != degree for value in got):
                failures.append("a rotation does not return a ring element")
            else:
                failures.append("a rotation does not match X^k times the polynomial")
            continue

        if tuple(module.monomial_rotate(par, poly, 0)) != tuple(poly):
            failures.append("rotating by zero is not the identity")
            continue
        if tuple(module.monomial_rotate(par, poly, 2 * degree)) != tuple(poly):
            failures.append("rotating by 2N is not the identity, so the exponent's modulus is wrong")
            continue
        # X^N = -1, stated as a property rather than inferred from the table above.
        negated = tuple((-value) % par["modulus"] for value in poly)
        if tuple(module.monomial_rotate(par, poly, degree)) != negated:
            failures.append("rotating by N does not negate the polynomial")
            continue
        # Composition: exponents add in the ring.
        for left, right in ((1, 1), (degree - 1, 2), (degree, degree), (2, -3)):
            once = module.monomial_rotate(par, module.monomial_rotate(par, poly, left), right)
            if tuple(once) != reference_rotate(par, poly, left + right):
                failures.append("rotating twice is not rotating by the sum of the exponents")
                break

        _, _, (ct0, _) = _pair(seed, par, "rotate")
        for k in (1, degree, 2 * degree, -2):
            try:
                rotated = _as_ciphertext(module.rotate_ciphertext(par, ct0, k))
            except Exception as error:  # noqa: BLE001
                failures.append(f"rotating a ciphertext raised {type(error).__name__}")
                break
            expected = reference_rotate_ciphertext(par, ct0, k)
            if rotated != expected:
                if rotated["b"] == expected["b"]:
                    failures.append("rotating a ciphertext leaves its `a` half unrotated")
                else:
                    failures.append("rotating a ciphertext does not rotate both halves")
                break
    return failures


# ---------------------------------------------------------------------------
# 5. Conditional rotation
# ---------------------------------------------------------------------------


def check_conditional(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        secret, _, (ct0, _) = _pair(seed, par, "conditional")
        exponent = par["degree"] + 1  # wraps once, so the sign shows in the plaintext
        held = rlwe_decrypt(par, secret, ct0)
        turned = tuple(
            decode(par, value)
            for value in reference_rotate(par, [encode(par, m) for m in held], exponent)
        )
        if held == turned:
            # The messages in `_pair` always move under this rotation, so reaching here
            # means the probe is broken rather than the submission -- say so instead of
            # crediting a checkpoint that would have proved nothing.
            failures.append("the probe rotation is invisible, so the check would prove nothing")
            return failures

        for bit in (0, 1):
            rgsw = rgsw_encrypt(par, secret, bit, rgsw_material(seed, par, f"cond:{bit}"))
            try:
                got = _as_ciphertext(module.conditional_rotate(par, rgsw, ct0, exponent))
            except Exception as error:  # noqa: BLE001
                return [f"the conditional rotation raised {type(error).__name__}"]
            want = held if bit == 0 else turned
            if rlwe_decrypt(par, secret, got) != want:
                if rlwe_decrypt(par, secret, got) == (turned if bit == 0 else held):
                    failures.append("the two candidates are the wrong way round")
                else:
                    failures.append(f"an encrypted {bit} did not {'hold' if bit == 0 else 'rotate'}")
                return failures

            # Graded on semantics, not on expression. A rotation applied before the CMUX
            # rather than inside it is a different ciphertext and an equally correct one,
            # so the ciphertext is compared only against the reference's *plaintext*.
            if got == _as_ciphertext(ct0) and bit == 1:
                failures.append("an encrypted 1 returned the input unchanged")
                return failures
    return failures


# ---------------------------------------------------------------------------
# 6. The blind rotation loop
# ---------------------------------------------------------------------------


def check_blind(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        ring_secret, bits, key, sample, plaintext, accumulator = _bootstrap(seed, par, "blind")
        try:
            got = _as_ciphertext(module.blind_rotate(par, key, sample, accumulator))
        except Exception as error:  # noqa: BLE001
            return [f"the blind rotation raised {type(error).__name__}"]

        # The model is computed in the clear, from the phase, without calling anything the
        # learner wrote. A direction that is reversed everywhere agrees with itself and
        # fails only here.
        want = reference_model(par, bits, sample, plaintext)
        if rlwe_decrypt(par, ring_secret, got) != want:
            unrotated = tuple(decode(par, value) for value in accumulator["b"])
            if rlwe_decrypt(par, ring_secret, got) == unrotated:
                failures.append("the accumulator came back unrotated")
            else:
                failures.append("the blind rotation does not match the plaintext reference model")
            return failures

        if got == _as_ciphertext(accumulator):
            failures.append("the blind rotation returned the accumulator it was handed")
            return failures

        # The key is what carries the secret. A loop that ignores it lands somewhere that
        # does not depend on the secret at all.
        flipped_bits = tuple(1 - bit for bit in bits)
        flipped = bootstrap_key(seed, par, ring_secret, flipped_bits, "blind:flipped")
        other = _as_ciphertext(module.blind_rotate(par, flipped, sample, accumulator))
        if rlwe_decrypt(par, ring_secret, other) != reference_model(
            par, flipped_bits, sample, plaintext
        ):
            failures.append("a different bootstrapping key did not change where the rotation lands")
            return failures

        # The exponents are only defined modulo 2N. A sample whose representatives sit
        # outside that window is the same sample, so the ciphertext has to come back
        # identical -- not merely decrypt the same way.
        try:
            loose = _as_ciphertext(module.blind_rotate(par, key, _unreduced(sample), accumulator))
        except Exception as error:  # noqa: BLE001
            failures.append(
                f"an LWE sample given outside [0, 2N) raised {type(error).__name__}"
            )
            return failures
        if loose != got:
            failures.append("an LWE sample given outside [0, 2N) is not normalized")
            return failures
    return failures


# ---------------------------------------------------------------------------
# 7. The trace
# ---------------------------------------------------------------------------


def check_trace(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        ring_secret, _, key, sample, _, accumulator = _bootstrap(seed, par, "trace")
        try:
            got = module.blind_rotate_trace(par, key, sample, accumulator)
        except Exception as error:  # noqa: BLE001
            return [f"tracing the blind rotation raised {type(error).__name__}"]
        want = reference_trace(par, key, sample, accumulator)

        if len(got) != len(want):
            failures.append("the trace does not have one record per step plus the offset")
            continue
        for mine, theirs in zip(got, want):
            for field in ("step", "mask", "exponent", "selector", "candidate0", "candidate1", "output"):
                if mine.get(field) != theirs[field]:
                    failures.append(f"a trace record's {field} is wrong")
                    return failures

        # The trace is the computation, not a commentary on it.
        product = _as_ciphertext(reference_blind_rotate(par, key, sample, accumulator))
        if got[-1]["output"] != digest(par, product):
            failures.append("the trace does not end at the rotation it describes")
            return failures

        # Every CMUX step produces something neither candidate could have supplied. A step
        # whose output repeats a candidate is a branch that was taken in the clear.
        #
        # Unless the two candidates are the same ciphertext, which happens whenever the
        # mask coefficient is zero -- and with coefficients drawn from `Z_(2N)` that is a
        # one-in-2N event, not a rarity. There the difference is zero, its digits are zero,
        # and the external product is exactly the zero ciphertext, so the output really is
        # the candidate. Nothing leaks: both candidates were identical to begin with.
        for record in got[1:]:
            if record["candidate0"] == record["candidate1"]:
                continue
            if record["output"] in (record["candidate0"], record["candidate1"]):
                failures.append("a CMUX step reported one of its candidates as its output")
                return failures

        # The same sample with representatives outside [0, 2N). `mask` reports what it was
        # handed; `exponent` reports it normalized, and those are now different numbers.
        loose_sample = _unreduced(sample)
        try:
            loose = module.blind_rotate_trace(par, key, loose_sample, accumulator)
        except Exception as error:  # noqa: BLE001
            failures.append(f"tracing an exponent outside [0, 2N) raised {type(error).__name__}")
            return failures
        loose_want = reference_trace(par, key, loose_sample, accumulator)
        if len(loose) != len(loose_want):
            failures.append("the trace does not have one record per step plus the offset")
            return failures
        for mine, theirs in zip(loose, loose_want):
            for field in ("mask", "exponent", "output"):
                if mine.get(field) != theirs[field]:
                    failures.append(
                        f"a trace record's {field} is wrong for an exponent outside [0, 2N)"
                    )
                    return failures

        # The public part of the trace must not move when the secret does. Only the digests
        # may differ, because they are digests of ciphertexts.
        other_bits = lwe_secret(seed, par, "trace:other")
        other_key = bootstrap_key(seed, par, ring_secret, other_bits, "trace:other")
        shifted = module.blind_rotate_trace(par, other_key, sample, accumulator)
        for mine, theirs in zip(got, shifted):
            for field in ("step", "mask", "exponent", "selector"):
                if mine.get(field) != theirs.get(field):
                    failures.append(f"a trace record's {field} depends on the secret")
                    return failures
    return failures


# ---------------------------------------------------------------------------
# 8. Transfer
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    """All of it, under a degree, dimension, base and modulus not seen elsewhere."""
    failures: list[str] = []
    for phase in (
        check_combine,
        check_cmux,
        check_rotate,
        check_conditional,
        check_blind,
        check_trace,
    ):
        failures.extend(phase(module, seed))
    return failures


PHASES = (
    check_combine,
    check_cmux,
    check_constant,
    check_rotate,
    check_conditional,
    check_blind,
    check_trace,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
