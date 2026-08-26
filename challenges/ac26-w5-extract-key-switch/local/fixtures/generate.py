"""Parameters, the supplied TFHE layer up to blind rotation, and this problem's ground truth.

Nothing here is copied from the course's toy TFHE exercise: no function names, no fixtures,
no skeleton. Parameters come from the seed and every convention is written out below, so a
learner who has read the official material gains no shortcut.

Everything through blind rotation is **supplied**. The ring, RLWE, the gadget, RGSW, the
external product, CMUX and the rotation loop are `ac26-w5-lwe-rlwe`, `-rgsw-external` and
`-cmux-blind-rotation`'s output. This problem is the two steps that come after: getting one
coefficient out of the accumulator as an LWE sample, and moving that sample to a different
key and dimension without changing what it says.

## Sample extraction

Blind rotation leaves an RLWE ciphertext `(a, b)` whose phase polynomial is `b - a*s`. Only
one coefficient of it is wanted. Extracting coefficient `k` means writing that coefficient
as an LWE phase over the ring secret's own coefficients:

    phase_k = b_k - sum_j c_j * s_j

    c_j =  a_(k-j)        for j <= k        no wrap, positive
    c_j = -a_(k-j+N)      for j >  k        wrapped past the degree, negated

The negation is the same `X^N = -1` from the rotation problem, seen from the other side: a
product term whose indices sum past the degree comes back with its sign flipped, so the mask
coefficient that collects it has to carry that flip. Nothing is decrypted and no noise is
added -- the extracted sample's phase **is** the polynomial's coefficient, exactly.

The resulting LWE secret is `(s_0, ..., s_(N-1))`, the ring secret read as a vector. That is
what makes the next step necessary: it is not the key the rest of the system uses.

## Key switching

Move an LWE sample from `s_old` (dimension `n_old`) to `s_new` (dimension `n_new`), with the
same message. The switching key holds, for every old index `j` and every level `l`, an LWE
encryption **under the new key** of the scalar `B^l * s_old[j]`:

    ksk[j][l] = LWE_(s_new)( B^l * s_old[j] )

Decompose each old mask coefficient into base-B digits and subtract the matching entries:

    c_j = sum_l d_(j,l) * B^l
    result = (0, body) - sum_(j,l) d_(j,l) * ksk[j][l]

The result's phase is `body - sum_(j,l) d_(j,l) * B^l * s_old[j] - noise`, and that sum is
exactly `<c, s_old>`. So the phase is the original one, less the noise the entries carried.
Nothing was decrypted: `s_old` appears only inside ciphertexts, and `s_new` never appears at
all. Key switching is not a decrypt-and-re-encrypt, and the absence of any decryption in
that derivation is the whole reason it is usable.

The decomposition convention is `ac26-w5-rgsw-external`'s, unchanged: `q = base ** levels`,
unsigned, LSB-first, exactly `levels` digits, gadget `(1, B, B^2, ...)`.

## Noise

Extraction adds none. Key switching adds `sum_(j,l) d_(j,l) * e_(j,l)`, bounded by
`n_old * levels * (base - 1) * NOISE_RANGE`. The accumulator arriving from a blind rotation
already carries `dimension` external products' worth. `VIABLE` is enumerated rather than
sampled so the total always fits, and
`scripts/ac26-w5-extract-key-switch.test.ts` checks the arithmetic rather than trusting this
paragraph.

None of this is secure. The parameters are small enough to enumerate and both secrets fall
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
#
# Issue 543 option B2: this module implements `phase_coefficient`, `extract_sample`,
# `extract_trace`, `decompose_mask`, `key_switch` and `domain_report` -- the six names
# `starter/extract.py` asks the learner to write -- because it cannot derive this
# deployment's trace, switched sample or domain report without them. So it ships in the
# `verifier` and `author` Docker stages only (see ../Dockerfile), never in the participant
# one, and `public_payload` at the bottom is what `show.py` and the public tests read
# instead, over the verifier's `GET /public`.
from participant.ring import (  # noqa: E402 - after the sys.path insert above
    centered,
    decode,
    decompose,
    decompose_poly,
    encode,
    gadget_vector,
    lwe_decrypt,
    lwe_phase_of,
    normalize,
    pad as _pad,
    ring_add,
    ring_mul,
    ring_sub,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_phase,
    rlwe_trivial,
)

#: (base, levels, degree, dimension, target_dimension) whose end-to-end noise fits the budget.
#: Enumerated rather than sampled: most combinations do not fit, and a parameter set that
#: silently exceeded the budget would make a correct submission fail.
#:
#: `degree` is the ring degree, so it is also the dimension of the *extracted* sample --
#: which is why `target_dimension` differs from it in every entry. A key switch that landed
#: on the same dimension it started from would let a submission that ignored the target
#: entirely still produce a plausibly-shaped answer.
VIABLE = (
    (2, 13, 4, 3, 2),
    (2, 13, 4, 3, 6),
    (2, 13, 4, 4, 3),
    (2, 14, 4, 3, 5),
    (2, 14, 8, 3, 5),
    (4, 7, 4, 3, 2),
    (4, 7, 4, 3, 6),
    (4, 7, 4, 4, 5),
    (4, 8, 8, 3, 4),
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
    base, levels, degree, dimension, target = VIABLE[_pick(s, 0, 0, len(VIABLE) - 1)]
    modulus = base**levels
    plaintext_modulus = 4
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "target_dimension": target,
        "modulus": modulus,
        "plaintext_modulus": plaintext_modulus,
        "delta": modulus // plaintext_modulus,
    }


def blind_rotation_noise(par: dict) -> int:
    """What the accumulator carries when it arrives from a blind rotation."""
    return par["dimension"] * 2 * par["levels"] * par["degree"] * (par["base"] - 1) * NOISE_RANGE


def key_switch_noise(par: dict) -> int:
    """What the switch adds: one digit times one entry's noise, over every index and level."""
    return par["degree"] * par["levels"] * (par["base"] - 1) * NOISE_RANGE


def noise_bound(par: dict) -> int:
    """The whole pipeline: blind rotation, extraction (free), then the switch."""
    return blind_rotation_noise(par) + key_switch_noise(par)


# ---------------------------------------------------------------------------
# Supplied: RLWE, RGSW, the external product, CMUX and blind rotation
# ---------------------------------------------------------------------------


def rlwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
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
    rows = 2 * par["levels"]
    return {
        "masks": tuple(ring_random(seed, par, f"{label}:m{j}") for j in range(rows)),
        "noises": tuple(ring_noise(seed, par, f"{label}:n{j}") for j in range(rows)),
    }


def rgsw_encrypt(par: dict, secret, selector: int, material: dict) -> tuple:
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
                (
                    normalize(par, mask),
                    normalize(par, [body[0] + selector * gadget[j - levels], *body[1:]]),
                )
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


def cmux(par: dict, rgsw, ct0: dict, ct1: dict) -> dict:
    difference = {
        "a": ring_sub(par, ct1["a"], ct0["a"]),
        "b": ring_sub(par, ct1["b"], ct0["b"]),
    }
    product = external_product(par, rgsw, difference)
    return {
        "a": ring_add(par, ct0["a"], product["a"]),
        "b": ring_add(par, ct0["b"], product["b"]),
    }


def monomial_rotate(par: dict, poly, exponent: int) -> tuple[int, ...]:
    shift = exponent % (2 * par["degree"])
    return normalize(par, [0] * shift + _pad(par, poly))


def rotate_ciphertext(par: dict, ciphertext: dict, exponent: int) -> dict:
    return {
        "a": monomial_rotate(par, ciphertext["a"], exponent),
        "b": monomial_rotate(par, ciphertext["b"], exponent),
    }


def lwe_secret_bits(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    s = _stream(seed, f"lwe-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["dimension"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["dimension"] - 1)] = 1
    return tuple(bits)


def lwe_sample(seed: str, par: dict, secret, label: str = "public") -> dict:
    modulus = 2 * par["degree"]
    s = _stream(seed, f"lwe-sample:{label}")
    mask = tuple(_pick(s, 2 * i, 0, modulus - 1) for i in range(par["dimension"]))
    phase = _pick(s, 200, 0, modulus - 1)
    body = (sum(m * k for m, k in zip(mask, secret)) + phase) % modulus
    return {"mask": mask, "body": body, "modulus": modulus}


def bootstrap_key(seed: str, par: dict, ring_key, bits, label: str = "public") -> tuple:
    return tuple(
        rgsw_encrypt(par, ring_key, bit, rgsw_material(seed, par, f"{label}:bk{i}"))
        for i, bit in enumerate(bits)
    )


def blind_rotate(par: dict, key, sample: dict, accumulator: dict) -> dict:
    current = rotate_ciphertext(par, accumulator, -sample["body"])
    for index, mask in enumerate(sample["mask"]):
        current = cmux(par, key[index], current, rotate_ciphertext(par, current, mask))
    return current


def test_vector(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """Coefficients from `{1, 3}` -- the residues negation moves, so a wrap stays visible."""
    s = _stream(seed, f"testvector:{label}")
    return tuple(1 + 2 * _pick(s, 2 * i, 0, 1) for i in range(par["degree"]))


def rotated_accumulator(seed: str, par: dict, ring_key, label: str = "public") -> dict:
    """A real blind-rotation output, which is what extraction is for.

    Everything the accumulator carries -- the noise from `dimension` external products
    included -- is what the switch downstream has to stay inside.
    """
    bits = lwe_secret_bits(seed, par, label)
    key = bootstrap_key(seed, par, ring_key, bits, label)
    sample = lwe_sample(seed, par, bits, label)
    return blind_rotate(par, key, sample, rlwe_trivial(par, test_vector(seed, par, label)))


# ---------------------------------------------------------------------------
# Ground truth: extraction
# ---------------------------------------------------------------------------


def phase_coefficient(par: dict, ring_key, ciphertext: dict, index: int) -> int:
    """Coefficient `index` of `b - a*s`, computed in the ring. The number extraction preserves."""
    if not 0 <= index < par["degree"]:
        raise ValueError("coefficient index outside the ring")
    return rlwe_phase(par, ring_key, ciphertext)[index]


def extract_sample(par: dict, ciphertext: dict, index: int) -> dict:
    """Coefficient `index` of the phase, rewritten as an LWE sample over the ring secret."""
    if not 0 <= index < par["degree"]:
        raise ValueError("coefficient index outside the ring")
    degree, q = par["degree"], par["modulus"]
    a = _pad(par, ciphertext["a"])
    mask = tuple(
        (a[index - j] if j <= index else -a[index - j + degree]) % q for j in range(degree)
    )
    return {"mask": mask, "body": _pad(par, ciphertext["b"])[index] % q}


def extract_trace(par: dict, ciphertext: dict, index: int) -> tuple[dict, ...]:
    """One record per extracted mask slot: where it came from and whether it wrapped."""
    degree, q = par["degree"], par["modulus"]
    a = _pad(par, ciphertext["a"])
    records = []
    for j in range(degree):
        wrapped = j > index
        source = index - j + degree if wrapped else index - j
        records.append(
            {
                "target": j,
                "source": source,
                "sign": -1 if wrapped else 1,
                "wrapped": wrapped,
                "value": (-a[source] if wrapped else a[source]) % q,
            }
        )
    return tuple(records)


# ---------------------------------------------------------------------------
# Ground truth: key switching
# ---------------------------------------------------------------------------


def target_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """The key being switched *to*. A different dimension, and never all zero."""
    s = _stream(seed, f"target-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["target_dimension"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["target_dimension"] - 1)] = 1
    return tuple(bits)


def key_id(seed: str, label: str) -> str:
    """A short, stable name for a key, so a ciphertext can say which one it belongs to."""
    return hashlib.sha256(f"key:{seed}:{label}".encode()).hexdigest()[:10]


def switching_key(
    seed: str, par: dict, source_secret, target, source_id: str, target_id: str, label: str
) -> dict:
    """`ksk[j][l] = LWE_target(B^l * source_secret[j])`, plus the metadata that names its domains.

    The scalar goes in raw, not through `encode`: the switch subtracts these from a phase and
    the arithmetic has to land exactly, not to within a rounding step.
    """
    gadget, q = gadget_vector(par), par["modulus"]
    entries = []
    for j, bit in enumerate(source_secret):
        row = []
        for level in range(par["levels"]):
            s = _stream(seed, f"ksk:{label}:{j}:{level}")
            mask = tuple(
                _pick(s, 2 * i, 0, q - 1) for i in range(par["target_dimension"])
            )
            noise = _pick(s, 300, -NOISE_RANGE, NOISE_RANGE)
            body = (
                sum(m * t for m, t in zip(mask, target)) + gadget[level] * bit + noise
            ) % q
            row.append({"mask": mask, "body": body})
        entries.append(tuple(row))
    return {
        "entries": tuple(entries),
        "sourceKeyId": source_id,
        "targetKeyId": target_id,
        "sourceDimension": len(source_secret),
        "targetDimension": par["target_dimension"],
        "base": par["base"],
        "levels": par["levels"],
        "modulus": q,
    }


def decompose_mask(par: dict, mask) -> tuple[tuple[int, ...], ...]:
    """One digit tuple per mask coefficient, LSB-first, exactly `levels` of them."""
    return tuple(decompose(par, value) for value in mask)


def key_switch(par: dict, key: dict, sample: dict) -> dict:
    """`(0, body) - sum d[j][l] * ksk[j][l]`, which lands under the target key.

    Nothing is decrypted here. `source_secret` only ever appears inside the switching key's
    ciphertexts, and the target secret does not appear at all.
    """
    if key["sourceDimension"] != len(sample["mask"]):
        raise ValueError("the switching key does not match the sample's dimension")
    if key["modulus"] != par["modulus"] or key["base"] != par["base"] or key["levels"] != par["levels"]:
        raise ValueError("the switching key was built for different parameters")
    if sample.get("keyId") is not None and sample["keyId"] != key["sourceKeyId"]:
        raise ValueError("the switching key is for a different source key")

    q = par["modulus"]
    accumulator = [0] * key["targetDimension"]
    body = sample["body"] % q
    digits = decompose_mask(par, sample["mask"])
    for j, per_level in enumerate(digits):
        for level, digit in enumerate(per_level):
            if not digit:
                continue
            entry = key["entries"][j][level]
            for i in range(key["targetDimension"]):
                accumulator[i] -= digit * entry["mask"][i]
            body -= digit * entry["body"]
    return {
        "mask": tuple(value % q for value in accumulator),
        "body": body % q,
        "keyId": key["targetKeyId"],
    }


def domain_report(par: dict, sample: dict, key: dict) -> dict:
    """What the artifacts say about which key and dimension each side lives in.

    Compatibility is decided from the declared metadata, not by trying to decrypt anything --
    that is the only way to decide it, since neither secret is here.
    """
    compatible = (
        key["sourceDimension"] == len(sample["mask"])
        and key["modulus"] == par["modulus"]
        and key["base"] == par["base"]
        and key["levels"] == par["levels"]
        and (sample.get("keyId") is None or sample["keyId"] == key["sourceKeyId"])
    )
    return {
        "sourceKeyId": key["sourceKeyId"],
        "targetKeyId": key["targetKeyId"],
        "sourceDimension": len(sample["mask"]),
        "targetDimension": key["targetDimension"],
        "modulus": par["modulus"],
        "base": par["base"],
        "levels": par["levels"],
        "compatible": compatible,
        "noiseAdded": len(sample["mask"]) * par["levels"] * (par["base"] - 1),
    }


def digest(par: dict, sample: dict) -> str:
    payload = ":".join(str(value) for value in (*sample["mask"], sample["body"]))
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def _key_payload(key: dict) -> dict:
    """A switching key as JSON: the same object, with its tuples spelled as lists."""
    return {
        "entries": [
            [{"mask": list(entry["mask"]), "body": entry["body"]} for entry in row]
            for row in key["entries"]
        ],
        "sourceKeyId": key["sourceKeyId"],
        "targetKeyId": key["targetKeyId"],
        "sourceDimension": key["sourceDimension"],
        "targetDimension": key["targetDimension"],
        "base": key["base"],
        "levels": key["levels"],
        "modulus": key["modulus"],
    }


def public_payload(seed: str) -> dict:
    """Everything the participant image is allowed to see, and nothing else.

    This is the single place that decides what "public" means for this problem, and it is
    exactly two things:

    - **The demonstration `show.py` has always printed.** The accumulator, the extraction
      trace for every index, the decomposed mask, the switched sample and the domain report
      were participant-visible before Issue 543 and stay participant-visible after it. The
      split moved where they are computed, not who may read them. Every index is carried
      because `make inspect INDEX=k` is part of that demonstration and this process cannot
      ask the verifier a second question.
    - **The inputs the public tests feed into the learner's own functions.** The parameters,
      the two secrets, the accumulator and the switching key -- arguments the graded
      functions receive anyway, and the secrets are what a public test needs to check that
      a message survived the switch.

    What is deliberately absent is any checkpoint's ground truth on a submission's own
    parameter set: every checkpoint is graded by running `tests/hidden/check_extract.py`
    against the learner's file, and `transfer` runs under a derived seed whose parameters
    appear nowhere below.
    """
    par = params(seed)
    degree = par["degree"]
    ring_key = rlwe_secret(seed, par, "ring")
    target = target_secret(seed, par, "target")
    source_id, target_id = key_id(seed, "ring"), key_id(seed, "target")

    show_accumulator = rotated_accumulator(seed, par, ring_key, "show")
    show_key = switching_key(seed, par, ring_key, target, source_id, target_id, "show")

    indices = {}
    for index in range(degree):
        sample = dict(extract_sample(par, show_accumulator, index))
        sample["keyId"] = source_id
        switched = key_switch(par, show_key, sample)
        indices[str(index)] = {
            "trace": [dict(record) for record in extract_trace(par, show_accumulator, index)],
            "sample": {"mask": list(sample["mask"]), "body": sample["body"], "keyId": source_id},
            "phase": lwe_phase_of(par, ring_key, sample),
            "coefficient": phase_coefficient(par, ring_key, show_accumulator, index),
            "digits": [list(row) for row in decompose_mask(par, sample["mask"])],
            "switched": {
                "mask": list(switched["mask"]),
                "body": switched["body"],
                "keyId": switched["keyId"],
            },
            "report": dict(domain_report(par, sample, show_key)),
            "decoded": {
                "coefficient": decode(par, phase_coefficient(par, ring_key, show_accumulator, index)),
                "extracted": lwe_decrypt(par, ring_key, sample),
                "switched": lwe_decrypt(par, target, switched),
            },
        }

    return {
        "healthToken": health_token(seed),
        "params": dict(par),
        "noiseBound": noise_bound(par),
        "budget": par["delta"] // 2,
        "accumulator": {"a": list(show_accumulator["a"]), "b": list(show_accumulator["b"])},
        "keyIds": {"source": source_id, "target": target_id},
        "indices": indices,
        # The public tests build their own scene from these, using the supplied
        # `participant/ring.py`: the same arguments the graded functions are handed, and
        # nothing that says what those functions should return.
        "testInputs": {
            "ringKey": list(ring_key),
            "targetKey": list(target),
            "accumulator": _accumulator_payload(rotated_accumulator(seed, par, ring_key)),
            "switchingKey": _key_payload(
                switching_key(seed, par, ring_key, target, source_id, target_id, "public")
            ),
        },
    }


def _accumulator_payload(accumulator: dict) -> dict:
    return {"a": list(accumulator["a"]), "b": list(accumulator["b"])}


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(
        f"health:{seed}:{par['base']}:{par['levels']}:{par['degree']}:{par['target_dimension']}".encode()
    ).hexdigest()[:16]
