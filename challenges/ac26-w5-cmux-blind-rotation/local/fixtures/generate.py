"""Parameters, the supplied ring/RLWE/RGSW layer, and the ground truth for this problem.

Nothing here is copied from the course's toy TFHE exercise: no function names, no fixtures,
no skeleton. Parameters come from the seed and every convention is written out below, so a
learner who has read the official material gains no shortcut.

The ring, RLWE, the gadget, RGSW and the **external product are supplied**. They are
`ac26-w5-lwe-rlwe` and `ac26-w5-rgsw-external`'s output, and re-deriving them is not what
this problem is about. This problem is CMUX, monomial rotation, and the blind rotation loop
that chains them.

## The encoding, fixed

    plaintext_modulus = 4      delta = q // 4      encode(m) = m * delta

Four, not two, and that is load-bearing. Negacyclic rotation negates a coefficient every
time it wraps past degree N, and with a plaintext modulus of two `-delta == delta (mod q)`:
the sign flip would be **invisible**, and an implementation that ignored `X^N = -1`
completely would score full marks. With four, negation maps `m -> (-m) mod 4`, which moves
1 and 3.

## Rotation, fixed

    X^(2N) = 1                 so an exponent is normalized modulo 2N, not modulo N
    X^N = -1                   so one wrap flips the sign, two wraps restore it

`monomial_rotate(poly, k)` is `X^k * poly` in `Z_q[X]/(X^N+1)`: coefficient i lands at
`(i + k) mod N`, negated when `((i + k) // N)` is odd. A negative k is normalized first;
`X^-1` is `X^(2N-1)`, not an error.

## Blind rotation, fixed

A toy LWE sample is `(mask, body)` over `Z_(2N)` -- already in the exponent's modulus, so
the modulus switch a real bootstrap needs is out of scope here:

    phase = (body - sum(mask[i] * secret[i])) mod 2N

`blind_rotate` computes `X^(-phase) * accumulator` **without ever learning phase**:

    ACC = X^(-body) * accumulator                       body is public; no CMUX needed
    for i:  ACC = CMUX(bk[i], ACC, X^(mask[i]) * ACC)   bk[i] = RGSW(secret[i])

Each CMUX multiplies in `X^(mask[i])` exactly when `secret[i]` is 1, so the product over
the loop is `X^(sum(mask[i] * secret[i]))` and the whole thing lands on
`X^(-body + <mask, secret>) = X^(-phase)`. Nothing branches: both candidates are computed
every round and the encrypted bit selects between them arithmetically.

Noise: every CMUX adds one external product's worth, `2 * L * N * (B-1) * NOISE_RANGE`, and
the rotations only permute and negate coefficients. Over an `n`-coefficient mask that is
`n` times the per-CMUX term, which is why the accumulator starts as a **trivial** ciphertext
(`a = 0`, `b = encoded`) carrying no noise at all. `VIABLE` is enumerated rather than
sampled so that total always fits, and `scripts/ac26-w5-cmux-blind-rotation.test.ts` checks
the arithmetic rather than trusting this paragraph.

None of this is secure. The parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.

## Where this module lives, since Issue 543 option B2

It implements `rlwe_add`, `rlwe_sub`, `cmux`, `monomial_rotate`, `rotate_ciphertext`,
`conditional_rotate`, `blind_rotate` and `blind_rotate_trace` -- the eight names
`starter/cmux.py` asks the learner to write -- because it cannot derive a deployment's CMUX
demonstration or its blind-rotation trace without them. So it ships in the `verifier` and
`author` Docker stages only (see ../Dockerfile), never in the participant one.
`public_payload` at the bottom is what `show.py` and the public tests read instead, over the
verifier's `GET /public`. The supplied half a participant still needs lives in
`participant/ring.py` and is imported below rather than restated, so the ring the learner
builds on and the ring the hidden suite grades against are the same functions.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The supplied half, single-sourced. `participant/ring.py` is the copy that ships in the
# participant image.
from participant.ring import (  # noqa: E402 - after the sys.path insert above
    centered,
    decode,
    decompose,
    decompose_poly,
    digest,
    encode,
    external_product,
    gadget_vector,
    normalize,
    pad as _pad,
    ring_add,
    ring_mul,
    ring_sub,
    rgsw_encrypt,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_phase,
    rlwe_trivial,
)

__all__ = [
    "VIABLE",
    "blind_rotate",
    "blind_rotate_trace",
    "bootstrap_key",
    "centered",
    "cmux",
    "conditional_rotate",
    "decode",
    "decompose",
    "decompose_poly",
    "digest",
    "encode",
    "external_product",
    "gadget_vector",
    "health_token",
    "lwe_phase",
    "lwe_sample",
    "lwe_secret",
    "monomial_rotate",
    "noise_bound",
    "normalize",
    "params",
    "public_payload",
    "reference_model",
    "rgsw_encrypt",
    "rgsw_material",
    "ring_add",
    "ring_mul",
    "ring_noise",
    "ring_random",
    "ring_sub",
    "rlwe_add",
    "rlwe_decrypt",
    "rlwe_encrypt",
    "rlwe_phase",
    "rlwe_secret",
    "rlwe_sub",
    "rlwe_trivial",
    "rotate_ciphertext",
    "test_vector",
]

#: (base, levels, degree, lwe_dimension) whose blind-rotation noise provably fits the budget.
#: Enumerated rather than sampled: most combinations do not fit, and a parameter set that
#: silently exceeded the budget would make a correct submission fail.
VIABLE = (
    (2, 12, 2, 3),
    (2, 13, 4, 3),
    (2, 13, 4, 4),
    (2, 14, 4, 4),
    (2, 14, 8, 3),
    (4, 6, 2, 3),
    (4, 7, 4, 3),
    (4, 7, 4, 4),
    (4, 7, 8, 3),
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
    base, levels, degree, dimension = VIABLE[_pick(s, 0, 0, len(VIABLE) - 1)]
    modulus = base**levels
    plaintext_modulus = 4
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "modulus": modulus,
        "plaintext_modulus": plaintext_modulus,
        "delta": modulus // plaintext_modulus,
    }


def noise_bound(par: dict) -> int:
    """The most the accumulator's noise can be after a full blind rotation.

    One external product per CMUX, `dimension` CMUXes, and the accumulator starts noiseless.
    The rotations contribute nothing: they permute and negate coefficients.
    """
    per_cmux = 2 * par["levels"] * par["degree"] * (par["base"] - 1) * NOISE_RANGE
    return par["dimension"] * per_cmux


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


def rgsw_material(seed: str, par: dict, label: str) -> dict:
    """The randomness an RGSW encryption consumes: one mask and one noise per row."""
    rows = 2 * par["levels"]
    return {
        "masks": tuple(ring_random(seed, par, f"{label}:m{j}") for j in range(rows)),
        "noises": tuple(ring_noise(seed, par, f"{label}:n{j}") for j in range(rows)),
    }


# ---------------------------------------------------------------------------
# The LWE sample and the bootstrapping key, as ground truth
# ---------------------------------------------------------------------------


def lwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """The bits the bootstrapping key encrypts. Never all zero."""
    s = _stream(seed, f"lwe-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["dimension"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["dimension"] - 1)] = 1
    return tuple(bits)


def lwe_sample(seed: str, par: dict, secret, label: str = "public") -> dict:
    """`(mask, body)` over `Z_(2N)`, with `body = <mask, secret> + phase`.

    The phase is drawn rather than derived so the reference model has something definite to
    compare against, and the mask is drawn independently -- an all-zero mask would make the
    loop trivial.
    """
    modulus = 2 * par["degree"]
    s = _stream(seed, f"lwe-sample:{label}")
    mask = tuple(_pick(s, 2 * i, 0, modulus - 1) for i in range(par["dimension"]))
    phase = _pick(s, 200, 0, modulus - 1)
    body = (sum(m * k for m, k in zip(mask, secret)) + phase) % modulus
    return {"mask": mask, "body": body, "modulus": modulus}


def lwe_phase(par: dict, secret, sample: dict) -> int:
    """`(body - <mask, secret>) mod 2N` -- the exponent blind rotation lands on, negated."""
    inner = sum(m * k for m, k in zip(sample["mask"], secret))
    return (sample["body"] - inner) % sample["modulus"]


def bootstrap_key(seed: str, par: dict, ring_secret, bits, label: str = "public") -> tuple:
    """One RGSW per LWE secret bit, all encrypted under the same ring secret.

    That is the key's whole job: it carries the LWE secret into the ring so the loop can
    choose with it without decrypting it. Every row of every RGSW uses distinct randomness,
    so two keys for the same bits are different ciphertexts.
    """
    return tuple(
        rgsw_encrypt(par, ring_secret, bit, rgsw_material(seed, par, f"{label}:bk{i}"))
        for i, bit in enumerate(bits)
    )


def test_vector(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """The accumulator's starting plaintext. Not constant, or a rotation would be invisible.

    Coefficients are drawn from `{1, 3}` rather than all of `Z_4`: those are the two
    residues that move under negation, so every wrap past degree N shows up in the decoded
    result instead of only in the ciphertext.
    """
    s = _stream(seed, f"testvector:{label}")
    return tuple(1 + 2 * _pick(s, 2 * i, 0, 1) for i in range(par["degree"]))


# ---------------------------------------------------------------------------
# Ground truth: rotation, CMUX, blind rotation
# ---------------------------------------------------------------------------


def monomial_rotate(par: dict, poly, exponent: int) -> tuple[int, ...]:
    """`X^exponent * poly` in `Z_q[X]/(X^N+1)`, for any integer exponent."""
    shift = exponent % (2 * par["degree"])
    return normalize(par, [0] * shift + _pad(par, poly))


def rotate_ciphertext(par: dict, ciphertext: dict, exponent: int) -> dict:
    """Both halves rotate. `X^k * (a, b)` is still an encryption, of `X^k * m`."""
    return {
        "a": monomial_rotate(par, ciphertext["a"], exponent),
        "b": monomial_rotate(par, ciphertext["b"], exponent),
    }


def rlwe_add(par: dict, left: dict, right: dict) -> dict:
    return {
        "a": ring_add(par, left["a"], right["a"]),
        "b": ring_add(par, left["b"], right["b"]),
    }


def rlwe_sub(par: dict, left: dict, right: dict) -> dict:
    return {
        "a": ring_sub(par, left["a"], right["a"]),
        "b": ring_sub(par, left["b"], right["b"]),
    }


def cmux(par: dict, rgsw, ct0: dict, ct1: dict) -> dict:
    """`ct0 + RGSW(mu) * (ct1 - ct0)`. Selector 0 keeps ct0, selector 1 keeps ct1."""
    return rlwe_add(par, ct0, external_product(par, rgsw, rlwe_sub(par, ct1, ct0)))


def conditional_rotate(par: dict, rgsw, ciphertext: dict, exponent: int) -> dict:
    """Rotate if the encrypted bit is 1, hold if it is 0 -- and compute both either way."""
    return cmux(par, rgsw, ciphertext, rotate_ciphertext(par, ciphertext, exponent))


def blind_rotate(par: dict, key, sample: dict, accumulator: dict) -> dict:
    """`X^(-phase) * accumulator`, reached without ever learning phase."""
    current = rotate_ciphertext(par, accumulator, -sample["body"])
    for index, mask in enumerate(sample["mask"]):
        current = conditional_rotate(par, key[index], current, mask)
    return current


def blind_rotate_trace(par: dict, key, sample: dict, accumulator: dict) -> tuple[dict, ...]:
    """One record per step, the first being the public offset rotation.

    `body` is public -- only the secret is not -- so step 0 has no encrypted choice and its
    two candidates are the same ciphertext. Every later step is a real CMUX, and its output
    is a fresh ciphertext that matches neither candidate.
    """
    modulus = 2 * par["degree"]
    rotated = rotate_ciphertext(par, accumulator, -sample["body"])
    records = [
        {
            "step": 0,
            "mask": sample["body"],
            "exponent": (-sample["body"]) % modulus,
            "selector": "phase-offset",
            "candidate0": digest(par, rotated),
            "candidate1": digest(par, rotated),
            "output": digest(par, rotated),
        }
    ]
    current = rotated
    for index, mask in enumerate(sample["mask"]):
        candidate1 = rotate_ciphertext(par, current, mask)
        output = cmux(par, key[index], current, candidate1)
        records.append(
            {
                "step": index + 1,
                "mask": mask,
                "exponent": mask % modulus,
                "selector": f"bk[{index}]",
                "candidate0": digest(par, current),
                "candidate1": digest(par, candidate1),
                "output": digest(par, output),
            }
        )
        current = output
    return tuple(records)


def reference_model(par: dict, secret, sample: dict, plaintext) -> tuple[int, ...]:
    """What blind rotation should land on, computed entirely in the clear.

    A separate model on purpose: comparing the loop against itself proves only that it is
    self-consistent, and a rotation direction that is reversed everywhere is exactly that.
    """
    phase = lwe_phase(par, secret, sample)
    rotated = monomial_rotate(par, [encode(par, m) for m in plaintext], -phase)
    return tuple(decode(par, value) for value in rotated)


def public_payload(seed: str) -> dict:
    """Everything the participant image is allowed to see, and nothing else.

    This is the single place that decides what "public" means for this problem, and it is
    exactly two things:

    - **The demonstration `show.py` has always printed.** The rotation table, the two-branch
      CMUX row, and the step-by-step blind-rotation trace were participant-visible before
      Issue 543 and stay participant-visible after it. The split moved where they are
      computed, not who may read them. Both `CASE` variants are carried, because `make
      inspect CASE=0` is part of that demonstration and this process cannot ask the
      verifier a second question.
    - **The inputs the public tests feed into the learner's own functions.** Parameters,
      secrets, the LWE sample, the bootstrapping key, the RGSW material and the test vector
      -- arguments the graded functions receive anyway.

    What is deliberately absent is any checkpoint's ground truth. Every checkpoint is graded
    by running `tests/hidden/check_cmux.py` against the learner's file on values derived
    here from the seed; `transfer` runs under a derived seed whose parameters appear nowhere
    below. The digests in the trace are hashes of ciphertexts, not the ciphertexts: a
    learner cannot invert one into an output their own loop failed to produce.
    """
    par = params(seed)
    degree = par["degree"]
    unit = tuple([1] + [0] * (degree - 1))
    secret = rlwe_secret(seed, par)
    m0 = tuple((index + 1) % par["plaintext_modulus"] for index in range(degree))
    m1 = tuple((value + 2) % par["plaintext_modulus"] for value in m0)
    ct0 = rlwe_encrypt(par, secret, m0, ring_random(seed, par, "s0"), ring_noise(seed, par, "s0"))
    ct1 = rlwe_encrypt(par, secret, m1, ring_random(seed, par, "s1"), ring_noise(seed, par, "s1"))

    branches = []
    for selector in (0, 1):
        rgsw = rgsw_encrypt(par, secret, selector, rgsw_material(seed, par, f"show{selector}"))
        out = cmux(par, rgsw, ct0, ct1)
        branches.append(
            {
                "selector": selector,
                "digest": digest(par, out),
                "decrypts": list(rlwe_decrypt(par, secret, out)),
                "equalsACandidate": (out["a"], out["b"])
                in ((ct0["a"], ct0["b"]), (ct1["a"], ct1["b"])),
            }
        )

    ring_secret = rlwe_secret(seed, par, "ring")
    plaintext = test_vector(seed, par, "show")
    accumulator = rlwe_trivial(par, plaintext)
    cases = {}
    for case, bits in (
        ("1", lwe_secret(seed, par)),
        ("0", tuple([0] * par["dimension"])),
    ):
        key = bootstrap_key(seed, par, ring_secret, bits, "show")
        sample = lwe_sample(seed, par, bits, "show")
        phase = lwe_phase(par, bits, sample)
        rotated = monomial_rotate(par, [encode(par, m) for m in plaintext], -phase)
        cases[case] = {
            "sample": {"mask": list(sample["mask"]), "body": sample["body"], "modulus": sample["modulus"]},
            "trace": [dict(record) for record in blind_rotate_trace(par, key, sample, accumulator)],
            "decrypts": list(rlwe_decrypt(par, ring_secret, blind_rotate(par, key, sample, accumulator))),
            "model": list(reference_model(par, bits, sample, plaintext)),
            "phase": phase,
            "rotatedDecodes": [decode(par, value) for value in rotated],
        }

    return {
        "healthToken": health_token(seed),
        "params": dict(par),
        "noiseBound": noise_bound(par),
        "budget": par["delta"] // 2,
        "rotationTable": {
            "unit": list(unit),
            "steps": [
                {"exponent": k, "result": list(monomial_rotate(par, unit, k))}
                for k in range(2 * degree + 1)
            ],
            "inverse": {
                "exponent": 2 * degree - 1,
                "result": list(monomial_rotate(par, unit, -1)),
            },
        },
        "branchDemo": {
            "m0": list(m0),
            "m1": list(m1),
            "rows": branches,
        },
        "accumulator": {"plaintext": list(plaintext), "a": list(accumulator["a"]), "b": list(accumulator["b"])},
        "cases": cases,
        # The public tests build their own ciphertexts and RGSW rows from these, using the
        # supplied `participant/ring.py` -- the same arguments the graded functions are
        # handed, and nothing that says what those functions should return.
        "testInputs": {
            "secret": list(secret),
            "ringSecret": list(ring_secret),
            "lweSecret": list(lwe_secret(seed, par)),
            "publicMask": list(ring_random(seed, par, "public")),
            "pair": {
                "m0": list(m0),
                "m1": list(m1),
                "masks": [list(ring_random(seed, par, f"pub{which}")) for which in (0, 1)],
                "noises": [list(ring_noise(seed, par, f"pub{which}")) for which in (0, 1)],
            },
            "rgswMaterial": _material_payload(rgsw_material(seed, par, "pub")),
            "bootstrapMaterial": [
                _material_payload(rgsw_material(seed, par, f"public:bk{index}"))
                for index in range(par["dimension"])
            ],
            "sample": _sample_payload(lwe_sample(seed, par, lwe_secret(seed, par))),
            "testVector": list(test_vector(seed, par)),
        },
    }


def _material_payload(material: dict) -> dict:
    return {
        "masks": [list(mask) for mask in material["masks"]],
        "noises": [list(noise) for noise in material["noises"]],
    }


def _sample_payload(sample: dict) -> dict:
    return {"mask": list(sample["mask"]), "body": sample["body"], "modulus": sample["modulus"]}


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(
        f"health:{seed}:{par['base']}:{par['levels']}:{par['degree']}:{par['dimension']}".encode()
    ).hexdigest()[:16]
