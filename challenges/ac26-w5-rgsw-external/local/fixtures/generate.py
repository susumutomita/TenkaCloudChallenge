"""Gadget parameters, the toy RLWE primitives, and the RGSW rows — all from FLAG_SEED.

Nothing here is copied from the course's toy TFHE exercise: no function names, no fixtures,
no skeleton. The parameters are generated from the seed and the conventions are written out
in full below, so a learner who has read the official material gains no shortcut.

The ring and the RLWE scheme are **supplied**. This problem is not about re-deriving them
-- `ac26-w5-lwe-rlwe` is -- so `ring_mul`, `rlwe_encrypt` and friends are correct and ready
to build on. They live in `participant/ring.py` and are imported below rather than restated,
so the ring a learner builds on is the same object the hidden suite grades against.

## Which side of the boundary this file is on

Issue 543 option B2: this module implements `gadget_vector`, `decompose`, `recompose`,
`decompose_poly`, `recompose_poly`, `levels_needed`, `smallest_unrepresentable`,
`rgsw_encrypt`, `external_product` and `external_trace` -- the ten names `starter/rgsw.py`
asks the learner to write -- because it cannot derive a deployment's rows, traces and
boundary witness without them. It therefore ships only in the verifier and author images
(see ../Dockerfile), never in the participant one. `public_payload` at the bottom is what
`show.py` and the public tests read instead, over the verifier's `GET /public`.

## The decomposition convention, fixed

    q = base ** levels                unsigned, LSB-first, exactly `levels` digits
    gadget = (1, B, B^2, ..., B^(L-1))
    decompose(x)  = the base-B digits of x mod q, least significant first
    recompose(d)  = sum(d[i] * gadget[i]) mod q

`q = base ** levels` is what makes recomposition **exact** for every value in `[0, q)`.
That is a choice, and the `failure` checkpoint is where it stops holding: give the same
base fewer levels than the modulus needs and some values stop round-tripping. Real
implementations use an approximate decomposition with a gadget of `q/B^i` and live with the
error; this one is exact so the error can be introduced deliberately rather than always
being present.

## RGSW, and why it has 2L rows

RGSW(mu) is `Z + mu * G`, where `Z` is 2L RLWE encryptions of zero stacked into a 2L x 2
matrix, and `G` is the gadget matrix:

    rows 0 .. L-1     put gadget[j]     in the **a** slot
    rows L .. 2L-1    put gadget[j-L]   in the **b** slot

The external product decomposes both halves of an RLWE ciphertext `(a, b)`, concatenates
the two digit vectors into one of length 2L, and multiplies it into the matrix:

    d = (decompose(a) ++ decompose(b))
    d . RGSW(mu) = d . Z + mu * (d . G) = RLWE(0) + mu * (a, b)

`d . G` reassembles `(a, b)` exactly -- that is the whole reason the rows are split across
the two slots -- so the result decrypts to `mu * m`. Selector 0 gives an encryption of
zero; selector 1 gives the message back. **Neither branch decrypts anything**, which is why
`external_product` is not given the secret.

Noise: the result carries `sum(d_j * e_j)` over 2L rows, bounded by `2 * L * N * (B-1)`
times the row noise. Every parameter set generated here is checked against the tolerated
interval, and `scripts/ac26-w5-rgsw-external.test.ts` asserts that it holds.

None of this is secure. The parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The supplied half, single-sourced. `participant/ring.py` is the copy that ships in the
# participant image; importing it here rather than restating it is what keeps the ring the
# learner builds on and the ring the hidden suite grades against the same functions.
from participant.ring import (  # noqa: E402 - after the sys.path insert above
    centered,
    decode,
    encode,
    normalize,
    pad as _pad,
    ring_add,
    ring_mul,
    ring_sub,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_phase,
)

__all__ = [
    "centered",
    "decode",
    "decompose",
    "decompose_poly",
    "encode",
    "external_product",
    "external_trace",
    "gadget_vector",
    "health_token",
    "levels_needed",
    "noise_bound",
    "normalize",
    "params",
    "public_payload",
    "recompose",
    "recompose_poly",
    "rgsw_encrypt",
    "rgsw_material",
    "ring_add",
    "ring_mul",
    "ring_noise",
    "ring_random",
    "ring_sub",
    "rlwe_decrypt",
    "rlwe_encrypt",
    "rlwe_phase",
    "rlwe_secret",
    "smallest_unrepresentable",
]

#: (base, levels, degree) triples whose external-product noise provably fits the budget.
#: Enumerated rather than sampled: most combinations do not fit, and a parameter set that
#: silently exceeds the budget would make a correct submission fail.
VIABLE = (
    (2, 7, 2),
    (2, 8, 2),
    (2, 9, 2),
    (2, 9, 4),
    (2, 10, 4),
    (4, 4, 2),
    (4, 5, 2),
    (4, 5, 4),
    (4, 6, 4),
)

#: Row noise stays in {-1, 0, 1}. Larger would need larger parameters for no extra lesson.
NOISE_RANGE = 1


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 500] * 256 + s[(i + 1) % 500]) % (high - low + 1))


def params(seed: str, label: str = "public") -> dict:
    s = _stream(seed, f"params:{label}")
    base, levels, degree = VIABLE[_pick(s, 0, 0, len(VIABLE) - 1)]
    modulus = base**levels
    plaintext_modulus = 2
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "modulus": modulus,
        "plaintext_modulus": plaintext_modulus,
        "delta": modulus // plaintext_modulus,
    }


def noise_bound(par: dict) -> int:
    """The most the external product's noise term can be, over 2L rows."""
    return 2 * par["levels"] * par["degree"] * (par["base"] - 1) * NOISE_RANGE


# ---------------------------------------------------------------------------
# The gadget, as ground truth
# ---------------------------------------------------------------------------


def gadget_vector(par: dict) -> tuple[int, ...]:
    return tuple(par["base"] ** i for i in range(par["levels"]))


def decompose(par: dict, value: int) -> tuple[int, ...]:
    """Unsigned base-B digits of `value mod q`, least significant first, exactly L of them."""
    base, remaining = par["base"], value % par["modulus"]
    digits = []
    for _ in range(par["levels"]):
        digits.append(remaining % base)
        remaining //= base
    return tuple(digits)


def recompose(par: dict, digits) -> int:
    return sum(d * g for d, g in zip(digits, gadget_vector(par))) % par["modulus"]


def decompose_poly(par: dict, poly) -> tuple[tuple[int, ...], ...]:
    """`levels` polynomials. Level i holds digit i of every coefficient, order preserved."""
    per_coefficient = [decompose(par, c) for c in _pad(par, poly)]
    return tuple(
        tuple(per_coefficient[k][i] for k in range(par["degree"]))
        for i in range(par["levels"])
    )


def recompose_poly(par: dict, levels) -> tuple[int, ...]:
    gadget = gadget_vector(par)
    return normalize(
        par,
        [
            sum(levels[i][k] * gadget[i] for i in range(par["levels"]))
            for k in range(par["degree"])
        ],
    )


def levels_needed(base: int, modulus: int) -> int:
    """How many base-B digits it takes to represent every value in [0, modulus)."""
    needed, covered = 0, 1
    while covered < modulus:
        covered *= base
        needed += 1
    return needed


def smallest_unrepresentable(base: int, levels: int, modulus: int) -> int | None:
    """The smallest value in [0, modulus) that L levels cannot round-trip, or None.

    It is `base ** levels`: everything below fits in L digits, and that value is the first
    that needs one more. None when the levels are sufficient.
    """
    reach = base**levels
    return reach if reach < modulus else None


# ---------------------------------------------------------------------------
# Supplied: toy RLWE
# ---------------------------------------------------------------------------


def rlwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """0/1 coefficients, never all zero -- an all-zero secret degenerates the scheme."""
    s = _stream(seed, f"secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["degree"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["degree"] - 1)] = 1
    return tuple(bits)


def ring_random(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"mask:{label}")
    return tuple(_pick(s, 2 * i, 0, par["modulus"] - 1) for i in range(par["degree"]))


def ring_noise(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"noise:{label}")
    return tuple(_pick(s, 2 * i, -NOISE_RANGE, NOISE_RANGE) for i in range(par["degree"]))


# `rlwe_encrypt`, `rlwe_phase` and `rlwe_decrypt` are imported from `participant.ring` at
# the top of this file: the scheme is supplied, so the learner's image and this one run the
# same three functions.


# ---------------------------------------------------------------------------
# RGSW and the external product, as ground truth
# ---------------------------------------------------------------------------


def rgsw_material(seed: str, par: dict, label: str) -> dict:
    """The randomness an RGSW encryption consumes: one mask and one noise per row."""
    rows = 2 * par["levels"]
    return {
        "masks": tuple(ring_random(seed, par, f"{label}:m{j}") for j in range(rows)),
        "noises": tuple(ring_noise(seed, par, f"{label}:n{j}") for j in range(rows)),
    }


def rgsw_encrypt(par: dict, secret, selector: int, material: dict) -> tuple:
    """2L rows of (a, b). Rows below L carry the gadget in `a`, rows above it in `b`."""
    levels, gadget = par["levels"], gadget_vector(par)
    rows = []
    for j in range(2 * levels):
        mask, noise = material["masks"][j], material["noises"][j]
        body = normalize(
            par, [x + y for x, y in zip(ring_mul(par, mask, secret), _pad(par, noise))]
        )
        if j < levels:
            rows.append(
                (normalize(par, [mask[0] + selector * gadget[j], *mask[1:]]), body)
            )
        else:
            rows.append(
                (normalize(par, mask), normalize(par, [body[0] + selector * gadget[j - levels], *body[1:]]))
            )
    return tuple(rows)


def external_product(par: dict, rgsw, ciphertext: dict) -> dict:
    digits = list(decompose_poly(par, ciphertext["a"])) + list(
        decompose_poly(par, ciphertext["b"])
    )
    left = right = tuple([0] * par["degree"])
    for j in range(2 * par["levels"]):
        left = ring_add(par, left, ring_mul(par, digits[j], rgsw[j][0]))
        right = ring_add(par, right, ring_mul(par, digits[j], rgsw[j][1]))
    return {"a": left, "b": right}


def external_trace(par: dict, rgsw, ciphertext: dict) -> tuple[dict, ...]:
    """One record per row: which slot the gadget sits in, the digits used, the running sum."""
    digits = list(decompose_poly(par, ciphertext["a"])) + list(
        decompose_poly(par, ciphertext["b"])
    )
    left = right = tuple([0] * par["degree"])
    out = []
    for j in range(2 * par["levels"]):
        partial_a = ring_mul(par, digits[j], rgsw[j][0])
        partial_b = ring_mul(par, digits[j], rgsw[j][1])
        left = ring_add(par, left, partial_a)
        right = ring_add(par, right, partial_b)
        out.append(
            {
                "row": j,
                "slot": "a" if j < par["levels"] else "b",
                "level": j if j < par["levels"] else j - par["levels"],
                "digits": digits[j],
                "partial_a": partial_a,
                "partial_b": partial_b,
                "accumulated_a": left,
                "accumulated_b": right,
            }
        )
    return tuple(out)


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(
        f"health:{seed}:{par['base']}:{par['levels']}:{par['degree']}".encode()
    ).hexdigest()[:16]


# ---------------------------------------------------------------------------
# The public half of a deployment (Issue 543 option B2)
# ---------------------------------------------------------------------------


def _case(seed: str, par: dict, secret, ciphertext: dict, selector: int) -> dict:
    """One selector's worth of what `make inspect` has always printed."""
    rgsw = rgsw_encrypt(par, secret, selector, rgsw_material(seed, par, "show"))
    product = external_product(par, rgsw, ciphertext)
    return {
        "rows": len(rgsw),
        "trace": [
            {
                "row": record["row"],
                "slot": record["slot"],
                "level": record["level"],
                "accumulated_a": list(record["accumulated_a"]),
                "accumulated_b": list(record["accumulated_b"]),
            }
            for record in external_trace(par, rgsw, ciphertext)
        ],
        "product": {"a": list(product["a"]), "b": list(product["b"])},
        "decrypted": list(rlwe_decrypt(par, secret, product)),
    }


def public_payload(seed: str) -> dict:
    """Everything the participant image is allowed to see, and nothing else.

    This is the single place that decides what "public" means for this problem. It is
    exactly two things:

    - **The demonstration `show.py` has always printed.** The gadget, one decomposition,
      the RGSW row layout, the accumulation trace and the level-exhaustion witness were
      participant-visible before Issue 543 and stay participant-visible after it. The
      split moved where they are computed, not who may read them.
    - **The inputs the public tests feed into the learner's own functions.** The
      parameters, the secret, the mask, the noise and the RGSW material -- arguments the
      graded functions receive anyway.

    What is deliberately absent is any checkpoint's ground truth on the *submission's*
    parameter set. Every checkpoint is graded by running `tests/hidden/check_rgsw.py`
    against the learner's file, on values derived here from the seed; `transfer` runs
    under a derived seed whose parameters appear nowhere below.
    """
    par = params(seed)
    base, levels, q = par["base"], par["levels"], par["modulus"]
    secret = rlwe_secret(seed, par)
    messages = tuple((i + 1) % par["plaintext_modulus"] for i in range(par["degree"]))
    ciphertext = rlwe_encrypt(
        par, secret, messages, ring_random(seed, par, "show"), ring_noise(seed, par, "show")
    )
    value = q // 3
    short = max(1, levels_needed(base, q) - 2)
    material = rgsw_material(seed, par, "pub")
    return {
        "healthToken": health_token(seed),
        "params": dict(par),
        "gadget": list(gadget_vector(par)),
        "noiseBound": noise_bound(par),
        "budget": par["delta"] // 2,
        "decomposition": {
            "value": value,
            "digits": list(decompose(par, value)),
            "recomposed": recompose(par, decompose(par, value)),
        },
        "ciphertext": {
            "messages": list(messages),
            "a": list(ciphertext["a"]),
            "b": list(ciphertext["b"]),
            "levels": [list(level) for level in decompose_poly(par, ciphertext["a"])],
        },
        "cases": {str(selector): _case(seed, par, secret, ciphertext, selector) for selector in (0, 1)},
        "exhaustion": {
            "shortLevels": short,
            "levelsNeeded": levels_needed(base, q),
            "witness": smallest_unrepresentable(base, short, q),
        },
        "inputs": {
            "secret": list(secret),
            "publicPoly": list(ring_random(seed, par, "public")),
            "mask": list(ring_random(seed, par, "pub")),
            "noise": list(ring_noise(seed, par, "pub")),
            "rgswMaterial": {
                "masks": [list(mask) for mask in material["masks"]],
                "noises": [list(noise) for noise in material["noises"]],
            },
        },
    }
