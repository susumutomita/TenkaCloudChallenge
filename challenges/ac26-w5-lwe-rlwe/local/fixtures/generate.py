"""Ring parameters, secrets, masks and noise — all derived from FLAG_SEED.

Nothing here is copied from the course's toy TFHE exercise: no function names, no
fixtures, no skeleton. The parameters are generated from the seed and the scheme is
written out in full below, so a learner who has read the official material gains no
shortcut and a learner who has not loses nothing.

The ring:

    R_q = Z_q[X] / (X^N + 1)        N a power of two, q = p * D

`X^N = -1` is the whole of it. A coefficient that wraps past degree N comes back with its
sign flipped, which is what makes the product **negacyclic** rather than cyclic. Getting
that sign wrong produces a ring that is perfectly consistent with itself and decrypts
almost everything correctly, which is why it is the first mutation.

The two schemes, side by side:

    LWE      secret s in {0,1}^n            b = <a, s> + encode(m) + e   (mod q)
    RLWE     secret S in R_q, 0/1 coeffs    B = A * S + encode(M) + E    (in R_q)

Same shape: something times the secret, plus the encoded message, plus noise. What
changes is the operation -- an inner product of vectors on one side, a negacyclic product
of polynomials on the other. RLWE is not LWE with longer vectors; the product is a
different product, and one RLWE ciphertext carries N messages rather than one.

Encryption takes its mask and its noise as arguments rather than sampling them. That is
deliberate: it makes every fixture reproducible and every hidden test deterministic
without pulling in a CSPRNG this problem is not about. A real implementation samples both,
and reusing a mask across two encryptions under one key is a break -- see the writeup.

None of this is secure. n, N and q are small enough to enumerate, and the secret is
recoverable from a handful of samples by linear algebra. It is a toy of the mechanism, not
of the hardness.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The deliberately-wrong product. It lives on the participant's side of the container
# boundary (Issue 543 option B2 -- see participant/wrong_ring.py and ../Dockerfile),
# because the problem statement tells a learner to read it: it is a stated weakness to
# build a counterexample against, not an answer. Imported rather than copied so the
# implementation a learner reads and the one `tests/hidden/check_lwe.py` compares
# against cannot drift apart.
from participant.wrong_ring import cyclic_mul  # noqa: E402

#: Powers of two only. The negacyclic wrap is defined by X^N = -1, and N must divide the
#: coefficient indexing cleanly for the fold to be a fold rather than a special case.
DEGREES = (2, 4, 8)
PLAINTEXT_MODULI = (2, 4)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 256:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 250] * 256 + s[(i + 1) % 250]) % (high - low + 1))


def _shuffled(s: list[int], values: list[int]) -> list[int]:
    """Fisher-Yates driven by the seed stream. Deterministic, and not the identity."""
    out = list(values)
    for i in range(len(out) - 1, 0, -1):
        j = _pick(s, 100 + 2 * i, 0, i)
        out[i], out[j] = out[j], out[i]
    return out


def params(seed: str, label: str = "public") -> dict:
    """One consistent parameter set.

    `delta` is kept comfortably larger than the noise bound so a correct implementation
    round-trips, and the `boundary` checkpoint is what pushes past it.
    """
    s = _stream(seed, f"params:{label}")
    degree = DEGREES[_pick(s, 0, 0, len(DEGREES) - 1)]
    plaintext_modulus = PLAINTEXT_MODULI[_pick(s, 4, 0, len(PLAINTEXT_MODULI) - 1)]
    delta = _pick(s, 8, 16, 64)
    dimension = _pick(s, 12, 2, 5)
    return {
        "degree": degree,
        "dimension": dimension,
        "plaintext_modulus": plaintext_modulus,
        "delta": delta,
        "modulus": plaintext_modulus * delta,
        # Noise is kept inside the tolerated interval for every round-trip fixture. The
        # `boundary` checkpoint supplies its own, larger noise.
        "noise_bound": max(1, delta // 4),
    }


# ---------------------------------------------------------------------------
# Encoding, shared by both schemes
# ---------------------------------------------------------------------------


def encode(par: dict, m: int) -> int:
    return (m % par["plaintext_modulus"]) * par["delta"] % par["modulus"]


def decode(par: dict, c: int) -> int:
    delta = par["delta"]
    return ((c % par["modulus"]) + delta // 2) // delta % par["plaintext_modulus"]


def centered(par: dict, x: int) -> int:
    q = par["modulus"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


def success_interval(par: dict) -> tuple[int, int]:
    """Same tie rule, and the same asymmetry, as ac26-w5-encoding-noise."""
    delta = par["delta"]
    return (-(delta // 2), delta - delta // 2 - 1)


# ---------------------------------------------------------------------------
# The ring
# ---------------------------------------------------------------------------


def normalize(par: dict, coefficients) -> tuple[int, ...]:
    """Fold to degree < N with X^N = -1, then reduce coefficients into [0, q).

    The fold is per-index rather than a loop: index i lands on i % N with sign
    (-1)^(i // N). Two wraps bring the sign back, which is easy to lose in a loop that
    negates once and stops.
    """
    n, q = par["degree"], par["modulus"]
    out = [0] * n
    for index, value in enumerate(coefficients):
        sign = -1 if (index // n) % 2 else 1
        out[index % n] = (out[index % n] + sign * value) % q
    return tuple(out)


def ring_add(par: dict, a, b) -> tuple[int, ...]:
    return normalize(par, [x + y for x, y in zip(_pad(par, a), _pad(par, b))])


def ring_sub(par: dict, a, b) -> tuple[int, ...]:
    return normalize(par, [x - y for x, y in zip(_pad(par, a), _pad(par, b))])


def ring_mul(par: dict, a, b) -> tuple[int, ...]:
    """Schoolbook product, then the negacyclic fold. No NTT: that is not this problem."""
    left, right = _pad(par, a), _pad(par, b)
    raw = [0] * (2 * par["degree"] - 1)
    for i, x in enumerate(left):
        for j, y in enumerate(right):
            raw[i + j] += x * y
    return normalize(par, raw)


def _pad(par: dict, coefficients) -> list[int]:
    values = list(coefficients)[: par["degree"]]
    return values + [0] * (par["degree"] - len(values))


# ---------------------------------------------------------------------------
# Secrets, masks, noise
# ---------------------------------------------------------------------------


def _nonzero_binary(s: list[int], length: int) -> tuple[int, ...]:
    """A 0/1 secret with at least one 1.

    The forcing is not cosmetic. An all-zero secret makes the mask term vanish, and then
    `b = encode(m) + e` regardless of what the implementation did with the secret: a
    sign-flipped inner product, a phase that adds instead of subtracts, and an
    implementation that ignores the mask entirely all round-trip perfectly. Three separate
    mutations survived on exactly this before it was forced -- the seed drew (0, 0, 0, 0,
    0) and the whole scheme degenerated.
    """
    bits = [_pick(s, 2 * i, 0, 1) for i in range(length)]
    if not any(bits):
        bits[_pick(s, 90, 0, length - 1)] = 1
    return tuple(bits)


def lwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    return _nonzero_binary(_stream(seed, f"lwe-secret:{label}"), par["dimension"])


def rlwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    return _nonzero_binary(_stream(seed, f"rlwe-secret:{label}"), par["degree"])


def lwe_mask(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"lwe-mask:{label}")
    return tuple(_pick(s, 2 * i, 0, par["modulus"] - 1) for i in range(par["dimension"]))


def rlwe_mask(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"rlwe-mask:{label}")
    return tuple(_pick(s, 2 * i, 0, par["modulus"] - 1) for i in range(par["degree"]))


def small_noise(seed: str, par: dict, label: str, count: int) -> tuple[int, ...]:
    """Noise inside the tolerated interval, both signs, never all zero.

    All-zero noise would let a submission that drops the noise term entirely round-trip
    perfectly, so at least one entry is forced non-zero.
    """
    s = _stream(seed, f"noise:{label}")
    bound = par["noise_bound"]
    values = [_pick(s, 2 * i, -bound, bound) for i in range(count)]
    if not any(values):
        values[0] = bound
    return tuple(values)


# ---------------------------------------------------------------------------
# The two schemes
# ---------------------------------------------------------------------------


def lwe_encrypt(par: dict, secret, message: int, mask, noise: int) -> dict:
    q = par["modulus"]
    product = sum(a * s for a, s in zip(mask, secret)) % q
    return {"a": tuple(int(a) % q for a in mask), "b": (product + encode(par, message) + noise) % q}


def lwe_decrypt(par: dict, secret, ciphertext: dict) -> dict:
    q = par["modulus"]
    product = sum(a * s for a, s in zip(ciphertext["a"], secret)) % q
    phase = (ciphertext["b"] - product) % q
    message = decode(par, phase)
    return {
        "phase": phase,
        "centered_phase": centered(par, phase),
        "message": message,
        # The noise is what is left once the encoded message is taken back out. It is
        # recoverable here only because this is a toy and the secret is in hand.
        "noise": centered(par, phase - encode(par, message)),
    }


def rlwe_encrypt(par: dict, secret, messages, mask, noise) -> dict:
    product = ring_mul(par, mask, secret)
    encoded = [encode(par, m) for m in _pad(par, messages)]
    body = normalize(par, [p + e + n for p, e, n in zip(product, encoded, _pad(par, noise))])
    return {"a": normalize(par, mask), "b": body}


def rlwe_decrypt(par: dict, secret, ciphertext: dict) -> dict:
    phase = ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))
    messages = tuple(decode(par, value) for value in phase)
    encoded = [encode(par, m) for m in messages]
    return {
        "phase": phase,
        "centered_phase": tuple(centered(par, value) for value in phase),
        "message": messages,
        "noise": tuple(centered(par, p - e) for p, e in zip(phase, encoded)),
    }


# ---------------------------------------------------------------------------
# Noise boundary samples
# ---------------------------------------------------------------------------


def boundary_samples(seed: str, par: dict) -> tuple[dict, ...]:
    """LWE samples whose noise sits inside, on, and past the tolerated interval.

    The order is **seed-derived**, so the index of the first failure is not a constant a
    submission could return without looking. Sorting by |noise| would put the first
    failure at a fixed position in every deployment, which is a different exercise.
    """
    low, high = success_interval(par)
    s = _stream(seed, "boundary")
    message = _pick(s, 0, 0, par["plaintext_modulus"] - 1)
    offsets = _shuffled(s, [0, 1, -1, high, low, high + 1, low - 1, high + 3, low - 3])
    secret = lwe_secret(seed, par, "boundary")
    out = []
    for index, noise in enumerate(offsets):
        mask = lwe_mask(seed, par, f"boundary:{index}")
        ciphertext = lwe_encrypt(par, secret, message, mask, noise)
        out.append(
            {
                "index": index,
                "ciphertext": ciphertext,
                "noise": noise,
                "expected": message,
                "decodes": lwe_decrypt(par, secret, ciphertext)["message"] == message,
            }
        )
    return tuple(out)


def first_boundary_crossing(seed: str, par: dict) -> int:
    """The index of the first sample that does not decode. Ground truth for checkpoint 6."""
    for sample in boundary_samples(seed, par):
        if not sample["decodes"]:
            return sample["index"]
    raise AssertionError("the boundary samples must contain a failure")


# ---------------------------------------------------------------------------
# Malformed inputs
# ---------------------------------------------------------------------------
#
# Stated here rather than constructed by the learner: rejecting a ciphertext you broke
# yourself proves nothing about the validator.


def malformed(par: dict) -> tuple[tuple[str, str, dict], ...]:
    """(kind, reason, ciphertext) triples that must all be rejected."""
    q, n, dim = par["modulus"], par["degree"], par["dimension"]
    return (
        ("lwe", "the mask has the wrong dimension", {"a": tuple([0] * (dim + 1)), "b": 0}),
        ("lwe", "a mask coefficient is outside [0, q)", {"a": tuple([q] + [0] * (dim - 1)), "b": 0}),
        ("lwe", "a mask coefficient is negative", {"a": tuple([-1] + [0] * (dim - 1)), "b": 0}),
        ("lwe", "the body is outside [0, q)", {"a": tuple([0] * dim), "b": q}),
        ("rlwe", "the mask polynomial has the wrong degree", {"a": tuple([0] * (n + 1)), "b": tuple([0] * n)}),
        ("rlwe", "the two polynomials come from different rings", {"a": tuple([0] * n), "b": tuple([0] * (n - 1))}),
        ("rlwe", "a coefficient is outside [0, q)", {"a": tuple([q] + [0] * (n - 1)), "b": tuple([0] * n)}),
        ("rlwe", "a coefficient is negative", {"a": tuple([0] * n), "b": tuple([-1] + [0] * (n - 1))}),
    )


def wellformed(seed: str, par: dict) -> tuple[tuple[str, dict], ...]:
    """Ciphertexts that must be accepted, including the all-zero edge case."""
    n, dim = par["degree"], par["dimension"]
    lwe = lwe_encrypt(par, lwe_secret(seed, par), 0, lwe_mask(seed, par, "wf"), 0)
    rlwe = rlwe_encrypt(
        par, rlwe_secret(seed, par), [0] * n, rlwe_mask(seed, par, "wf"), [0] * n
    )
    return (
        ("lwe", lwe),
        ("lwe", {"a": tuple([0] * dim), "b": 0}),
        ("rlwe", rlwe),
        ("rlwe", {"a": tuple([0] * n), "b": tuple([0] * n)}),
    )


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(f"health:{seed}:{par['modulus']}:{par['degree']}".encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# The public half of a deployment
# ---------------------------------------------------------------------------


def public_payload(seed: str) -> dict:
    """Everything `show.py` prints and everything the public tests need as input.

    Issue 543 option B2. This module does not ship in the participant image any more:
    it has to define working `normalize`, `ring_mul`, `lwe_encrypt`, `lwe_decrypt`,
    `rlwe_encrypt`, `rlwe_decrypt`, `encode`, `decode` and `centered` to derive a
    deployment's fixtures, and those are exactly the names `starter/lwe.py` asks the
    learner to write -- eleven stubs, one import away, with no comparison anywhere near
    them. `verifier/server.py` serves this dict on `GET /public` over the
    Compose-internal network instead, and `show.py` and `tests/public/test_lwe.py` read
    it from there.

    What is in here is the *question*, not an answer:

    - the parameters, the noise budget, the health token and the two traces are what
      `show.py` has always printed;
    - the ring demonstration is the same single wrap `show.py` has always printed, with
      the negacyclic and the cyclic product side by side;
    - the boundary samples carry `index`, `noise` and `decodes` -- the three columns
      `show.py` has always printed. The `boundary` checkpoint asks which one crosses
      first *in this order*, which is a reading of that table by design;
    - the secrets and masks under `inputs` are *arguments* the graded functions receive.
      Every hidden phase passes the secret in, so knowing it decides nothing, and
      `make inspect MODE=debug` has always printed both.

    `normalizeProbe` is the one addition: the fold of a single concrete input, so the
    public test that checks `normalize` against the ring keeps the strength it had when
    it could import the reference. It is a worked example of the same kind as the ring
    demonstration above -- the graded phases run across five parameter sets that vary
    degree, dimension, plaintext modulus and delta together, on inputs this one pair
    does not determine.

    Nothing derived under a non-`public` label appears here, and no checkpoint's
    expected value is computed at all.
    """
    par = params(seed)
    n = par["degree"]
    low, high = success_interval(par)

    top = tuple([0] * (n - 1) + [1])
    unit_x = tuple([0, 1] + [0] * (n - 2)) if n > 1 else (1,)

    lwe_key = lwe_secret(seed, par)
    show_lwe_mask = lwe_mask(seed, par, "show")
    show_lwe_noise = small_noise(seed, par, "show", 1)[0]
    lwe_message = 1 % par["plaintext_modulus"]
    lwe_ciphertext = lwe_encrypt(par, lwe_key, lwe_message, show_lwe_mask, show_lwe_noise)
    lwe_result = lwe_decrypt(par, lwe_key, lwe_ciphertext)

    rlwe_key = rlwe_secret(seed, par)
    show_rlwe_mask = rlwe_mask(seed, par, "show")
    show_rlwe_noise = small_noise(seed, par, "show", n)
    rlwe_messages = tuple((position + 1) % par["plaintext_modulus"] for position in range(n))
    rlwe_ciphertext = rlwe_encrypt(par, rlwe_key, rlwe_messages, show_rlwe_mask, show_rlwe_noise)
    rlwe_result = rlwe_decrypt(par, rlwe_key, rlwe_ciphertext)

    probe = list(range(3 * n))
    return {
        "params": dict(par),
        "healthToken": health_token(seed),
        "interval": [low, high],
        "ring": {
            "top": list(top),
            "x": list(unit_x),
            "negacyclic": list(ring_mul(par, top, unit_x)),
            "cyclic": list(cyclic_mul(par, top, unit_x)),
        },
        "lwe": {
            "message": lwe_message,
            "encoded": encode(par, lwe_message),
            "mask": list(lwe_ciphertext["a"]),
            "product": (lwe_ciphertext["b"] - lwe_result["phase"]) % par["modulus"],
            "noise": show_lwe_noise,
            "body": lwe_ciphertext["b"],
            "phase": lwe_result["phase"],
            "centeredPhase": lwe_result["centered_phase"],
            "decoded": lwe_result["message"],
        },
        "rlwe": {
            "messages": list(rlwe_messages),
            "encoded": [encode(par, message) for message in rlwe_messages],
            "mask": list(rlwe_ciphertext["a"]),
            "product": list(ring_mul(par, rlwe_ciphertext["a"], rlwe_key)),
            "noise": list(show_rlwe_noise),
            "body": list(rlwe_ciphertext["b"]),
            "phase": list(rlwe_result["phase"]),
            "centeredPhase": list(rlwe_result["centered_phase"]),
            "decoded": list(rlwe_result["message"]),
        },
        "boundary": [
            {"index": sample["index"], "noise": sample["noise"], "decodes": sample["decodes"]}
            for sample in boundary_samples(seed, par)
        ],
        "inputs": {
            "lweSecret": list(lwe_key),
            "rlweSecret": list(rlwe_key),
            "lweMask": list(lwe_mask(seed, par, "public")),
            "rlweMask": list(rlwe_mask(seed, par, "public")),
            "normalizeProbe": {"input": probe, "expected": list(normalize(par, probe))},
        },
    }
