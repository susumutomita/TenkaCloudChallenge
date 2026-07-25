"""Reference implementation. Lives inside the image only; never mounted to the host.

Used by two things: the mutation suite (which breaks copies of this file and asserts the
hidden tests catch each break), and the `reference-test` CI target.

Everything reads `params`. Nothing hardcodes a degree, a modulus, or a dimension, because
the `transfer` checkpoint runs the whole file under a parameter set derived from a
different seed -- and because hardcoding N is one of the mutations.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Encoding, shared by both schemes
# ---------------------------------------------------------------------------


def encode(params: dict, m: int) -> int:
    return (m % params["plaintext_modulus"]) * params["delta"] % params["modulus"]


def decode(params: dict, c: int) -> int:
    delta = params["delta"]
    return ((c % params["modulus"]) + delta // 2) // delta % params["plaintext_modulus"]


def centered(params: dict, x: int) -> int:
    q = params["modulus"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


# ---------------------------------------------------------------------------
# The ring R_q = Z_q[X] / (X^N + 1)
# ---------------------------------------------------------------------------


def normalize(params: dict, coefficients) -> tuple[int, ...]:
    """Fold to degree < N using X^N = -1, then reduce coefficients into [0, q).

    Per-index rather than a loop over wraps: index i lands on `i % N` with sign
    `(-1) ** (i // N)`. Two wraps bring the sign back, which a loop that negates once and
    stops gets wrong for any input longer than 2N -- and `ring_mul` feeds this inputs of
    length 2N - 1, so a single wrap is enough there but not in general.
    """
    n, q = params["degree"], params["modulus"]
    out = [0] * n
    for index, value in enumerate(coefficients):
        sign = -1 if (index // n) % 2 else 1
        out[index % n] = (out[index % n] + sign * value) % q
    return tuple(out)


def _pad(params: dict, coefficients) -> list[int]:
    values = list(coefficients)[: params["degree"]]
    return values + [0] * (params["degree"] - len(values))


def ring_add(params: dict, a, b) -> tuple[int, ...]:
    return normalize(params, [x + y for x, y in zip(_pad(params, a), _pad(params, b))])


def ring_sub(params: dict, a, b) -> tuple[int, ...]:
    return normalize(params, [x - y for x, y in zip(_pad(params, a), _pad(params, b))])


def ring_mul(params: dict, a, b) -> tuple[int, ...]:
    """Schoolbook product, then the negacyclic fold.

    No NTT. The point here is the wrap, and an NTT would hide it behind a transform that
    has to be told the same sign convention anyway.
    """
    left, right = _pad(params, a), _pad(params, b)
    raw = [0] * (2 * params["degree"] - 1)
    for i, x in enumerate(left):
        for j, y in enumerate(right):
            raw[i + j] += x * y
    return normalize(params, raw)


# ---------------------------------------------------------------------------
# LWE
# ---------------------------------------------------------------------------


def lwe_encrypt(params: dict, secret, message: int, mask, noise: int) -> dict:
    """b = <a, s> + encode(m) + e. The mask and the noise are given, not sampled.

    A ciphertext holds `a` and `b` and nothing else. Keeping the message or the secret in
    the returned object would make every round-trip test pass while the scheme encrypts
    nothing -- one of the mutations does exactly that.
    """
    q = params["modulus"]
    product = sum(a * s for a, s in zip(mask, secret)) % q
    return {
        "a": tuple(int(a) % q for a in mask),
        "b": (product + encode(params, message) + noise) % q,
    }


def lwe_decrypt(params: dict, secret, ciphertext: dict) -> dict:
    """Cancel the secret, then read what is left.

    The phase is `b - <a, s>`, and the sign matters: `+` instead of `-` decrypts correctly
    whenever the product happens to be its own negative, which for a small dimension and a
    binary secret is often enough to pass a hand-written test.
    """
    q = params["modulus"]
    product = sum(a * s for a, s in zip(ciphertext["a"], secret)) % q
    phase = (ciphertext["b"] - product) % q
    message = decode(params, phase)
    return {
        "phase": phase,
        "centered_phase": centered(params, phase),
        "message": message,
        # Recoverable only because this is a toy and the secret is in hand. A real
        # decryptor never sees this; it is here so the noise budget is watchable.
        "noise": centered(params, phase - encode(params, message)),
    }


# ---------------------------------------------------------------------------
# RLWE
# ---------------------------------------------------------------------------


def rlwe_encrypt(params: dict, secret, messages, mask, noise) -> dict:
    """B = A * S + encode(M) + E, with the product taken in the ring.

    Same three terms as LWE. What changed is the operation and the payload: one ciphertext
    now carries N messages, one per coefficient.
    """
    product = ring_mul(params, mask, secret)
    encoded = [encode(params, m) for m in _pad(params, messages)]
    body = normalize(
        params, [p + e + n for p, e, n in zip(product, encoded, _pad(params, noise))]
    )
    return {"a": normalize(params, mask), "b": body}


def rlwe_decrypt(params: dict, secret, ciphertext: dict) -> dict:
    phase = ring_sub(params, ciphertext["b"], ring_mul(params, ciphertext["a"], secret))
    messages = tuple(decode(params, value) for value in phase)
    encoded = [encode(params, m) for m in messages]
    return {
        "phase": phase,
        "centered_phase": tuple(centered(params, value) for value in phase),
        "message": messages,
        "noise": tuple(centered(params, p - e) for p, e in zip(phase, encoded)),
    }


# ---------------------------------------------------------------------------
# What the two have in common, and what they do not
# ---------------------------------------------------------------------------


def correspondence(params: dict, lwe, rlwe) -> dict:
    """A structured side-by-side of one LWE and one RLWE decryption.

    Each argument is `{"secret": ..., "ciphertext": ...}`. The labels are not decoration:
    naming the RLWE operation an inner product is the `rlwe-is-longer-lwe` misconception
    written down, and the phase computed that way is a different number.
    """
    lwe_result = lwe_decrypt(params, lwe["secret"], lwe["ciphertext"])
    rlwe_result = rlwe_decrypt(params, rlwe["secret"], rlwe["ciphertext"])
    return {
        "lwe": {
            "secret_kind": "vector",
            "mask_kind": "vector",
            "operation": "inner-product",
            "payload_size": 1,
            "phase": lwe_result["phase"],
            "centered_phase": lwe_result["centered_phase"],
            "noise": lwe_result["noise"],
            "message": lwe_result["message"],
        },
        "rlwe": {
            "secret_kind": "polynomial",
            "mask_kind": "polynomial",
            "operation": "negacyclic-product",
            "payload_size": params["degree"],
            "phase": rlwe_result["phase"],
            "centered_phase": rlwe_result["centered_phase"],
            "noise": rlwe_result["noise"],
            "message": rlwe_result["message"],
        },
        # The shape both share, stated once rather than implied.
        "shared_structure": "secret-product + encoded-message + noise",
    }


# ---------------------------------------------------------------------------
# The noise boundary
# ---------------------------------------------------------------------------


def survives(params: dict, noise: int) -> bool:
    """Whether a phase carrying this much noise still decodes to its own message.

    Same interval, and the same asymmetry, as ac26-w5-encoding-noise: ties round up, so
    the upper end is one short when delta is even.
    """
    delta = params["delta"]
    return -(delta // 2) <= noise <= delta - delta // 2 - 1


def first_crossing(params: dict, samples) -> int:
    """The index of the first sample in the given order whose noise is out of budget.

    In the given order. The samples are not sorted by magnitude, so this is a scan rather
    than a formula, and -1 when every sample survives.
    """
    for sample in samples:
        if not survives(params, sample["noise"]):
            return sample["index"]
    return -1


# ---------------------------------------------------------------------------
# Malformed input
# ---------------------------------------------------------------------------


def validate_ciphertext(params: dict, kind: str, ciphertext: dict) -> list[str]:
    """Reasons this ciphertext cannot be used, empty when it can.

    Canonical form is not pedantry here. `a` and `b` are ring or vector elements in
    `[0, q)`; accepting a negative coefficient means two encodings of the same ciphertext
    compare unequal, and accepting a wrong length means an operation between two rings
    silently produces a third.
    """
    q = params["modulus"]
    expected = params["dimension"] if kind == "lwe" else params["degree"]
    failures: list[str] = []

    mask = ciphertext.get("a")
    body = ciphertext.get("b")
    if not isinstance(mask, (tuple, list)):
        return ["the mask is not a sequence"]
    if len(mask) != expected:
        failures.append(f"the mask has {len(mask)} entries, not {expected}")

    if kind == "lwe":
        bodies = [body] if isinstance(body, int) and not isinstance(body, bool) else None
        if bodies is None:
            failures.append("the body is not an integer")
            bodies = []
    else:
        if not isinstance(body, (tuple, list)):
            failures.append("the body is not a sequence")
            bodies = []
        else:
            bodies = list(body)
            # Both halves have to live in the same ring. Different lengths mean the
            # ciphertext was assembled from two different parameter sets.
            if len(bodies) != expected:
                failures.append(f"the body has {len(bodies)} coefficients, not {expected}")

    for value in list(mask) + list(bodies):
        if not isinstance(value, int) or isinstance(value, bool):
            failures.append("a coefficient is not an integer")
            break
        if not 0 <= value < q:
            failures.append("a coefficient is outside [0, q)")
            break

    return failures
