"""Reference implementation. Lives inside the image only; not bind-mounted.

Used by two things: the mutation suite (which breaks copies of this file and asserts the
hidden tests catch each break), and the `reference-test` CI target.

Everything through blind rotation is supplied by `participant.fhe`. This problem is the
two steps that come after it. Nothing here hardcodes a degree, a dimension, a base or a
level count, because `transfer` runs the whole file under parameters derived from a
different seed.
"""

from __future__ import annotations

from participant.fhe import decompose, rlwe_phase


# ---------------------------------------------------------------------------
# The equation extraction has to preserve
# ---------------------------------------------------------------------------


def phase_coefficient(params: dict, ring_key, ciphertext: dict, index: int) -> int:
    """Coefficient `index` of `b - a*s`, computed in the ring.

    This is the reference the rest of the problem is measured against, and the only place a
    secret appears at all. Extraction does not get one, and does not need one: the number
    below is what it has to preserve, not something it has to recompute.
    """
    if not 0 <= index < params["degree"]:
        raise ValueError("coefficient index outside the ring")
    return rlwe_phase(params, ring_key, ciphertext)[index]


# ---------------------------------------------------------------------------
# Sample extraction
# ---------------------------------------------------------------------------


def extract_sample(params: dict, ciphertext: dict, index: int) -> dict:
    """Coefficient `index` of the phase, rewritten as an LWE sample over the ring secret.

    `(a*s)_index` collects every product `a_i * s_j` whose indices meet at `index` in the
    ring. For a given secret index `j` there is exactly one such `i`:

    ```text
    j <= index    i = index - j            no wrap, contributes  +a_i
    j >  index    i = index - j + N        wrapped past N, so    -a_i
    ```

    The negation is `X^N = -1` seen from the other side. A mask built without it is a
    perfectly plausible vector whose inner product with the secret is simply a different
    number, and the phase it preserves is not the one that was asked for.

    Nothing is decrypted and no noise is added. The extracted phase **is** the coefficient,
    exactly -- and the resulting LWE secret is the ring secret read as a vector, which is
    the reason the next step exists.
    """
    if not 0 <= index < params["degree"]:
        raise ValueError("coefficient index outside the ring")
    degree, modulus = params["degree"], params["modulus"]
    a = _padded(params, ciphertext["a"])
    mask = tuple(
        (a[index - j] if j <= index else -a[index - j + degree]) % modulus
        for j in range(degree)
    )
    return {"mask": mask, "body": _padded(params, ciphertext["b"])[index] % modulus}


def _padded(params: dict, coefficients) -> list[int]:
    degree = params["degree"]
    values = list(coefficients)[:degree]
    return values + [0] * (degree - len(values))


def extract_trace(params: dict, ciphertext: dict, index: int) -> tuple[dict, ...]:
    """One record per extracted mask slot: where it came from, and whether it wrapped.

    Read down the `wrapped` column and the boundary is visible at `index`: everything at or
    below it is a straight copy, everything above it is negated.
    """
    degree, modulus = params["degree"], params["modulus"]
    a = _padded(params, ciphertext["a"])
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
                "value": (-a[source] if wrapped else a[source]) % modulus,
            }
        )
    return tuple(records)


# ---------------------------------------------------------------------------
# Key switching
# ---------------------------------------------------------------------------


def decompose_mask(params: dict, mask) -> tuple[tuple[int, ...], ...]:
    """One digit tuple per mask coefficient, LSB-first, exactly `levels` of them.

    Same convention as `ac26-w5-rgsw-external`, and `decompose` is supplied. The shape is
    the part worth getting right: one tuple **per coefficient**, not one per level. The
    external product wanted the transpose of this, because it multiplied a level by a ring
    element; here each coefficient's digits index into that coefficient's own key entries.
    """
    return tuple(decompose(params, value) for value in mask)


def key_switch(params: dict, switching_key: dict, sample: dict) -> dict:
    """`(0, body) - sum d[j][l] * ksk[j][l]`, which lands under the target key.

    The switching key holds `ksk[j][l] = LWE_target(B^l * source[j])`. Subtracting
    `d[j][l]` of each removes `sum d[j][l] * B^l * source[j]` from the phase, and that sum
    is `<mask, source>` -- so what is left is `body - <mask, source>`, the original phase,
    less the noise the entries carried.

    Nothing is decrypted anywhere in that. The source secret appears only inside the key's
    ciphertexts and the target secret does not appear at all, which is what makes this
    usable and what makes "decrypt and re-encrypt" the wrong picture of it.

    A key that does not match is rejected rather than applied. It would produce a
    well-formed ciphertext that decrypts to noise under both keys, which is worse than an
    error.
    """
    _require_compatible(params, switching_key, sample)

    modulus = params["modulus"]
    accumulator = [0] * switching_key["targetDimension"]
    body = sample["body"] % modulus
    for j, digits in enumerate(decompose_mask(params, sample["mask"])):
        for level, digit in enumerate(digits):
            if not digit:
                continue
            entry = switching_key["entries"][j][level]
            for i in range(switching_key["targetDimension"]):
                accumulator[i] -= digit * entry["mask"][i]
            body -= digit * entry["body"]
    return {
        "mask": tuple(value % modulus for value in accumulator),
        "body": body % modulus,
        "keyId": switching_key["targetKeyId"],
    }


def _require_compatible(params: dict, switching_key: dict, sample: dict) -> None:
    if switching_key["sourceDimension"] != len(sample["mask"]):
        raise ValueError("the switching key does not match the sample's dimension")
    if (
        switching_key["modulus"] != params["modulus"]
        or switching_key["base"] != params["base"]
        or switching_key["levels"] != params["levels"]
    ):
        raise ValueError("the switching key was built for different parameters")
    if sample.get("keyId") is not None and sample["keyId"] != switching_key["sourceKeyId"]:
        raise ValueError("the switching key is for a different source key")


def domain_report(params: dict, sample: dict, switching_key: dict) -> dict:
    """Which key and dimension each side lives in, read off the declared metadata.

    There is no other way to decide it. Neither secret is here, so compatibility cannot be
    established by trying the switch and seeing whether the result decrypts -- and a system
    that decided it that way would need the secrets in the one place they must not be.

    `noiseAdded` is the bound rather than a measurement, for the same reason: measuring it
    would take a phase, and a phase takes a key.
    """
    return {
        "sourceKeyId": switching_key["sourceKeyId"],
        "targetKeyId": switching_key["targetKeyId"],
        "sourceDimension": len(sample["mask"]),
        "targetDimension": switching_key["targetDimension"],
        "modulus": params["modulus"],
        "base": params["base"],
        "levels": params["levels"],
        "compatible": _compatible(params, sample, switching_key),
        "noiseAdded": len(sample["mask"]) * params["levels"] * (params["base"] - 1),
    }


def _compatible(params: dict, sample: dict, switching_key: dict) -> bool:
    try:
        _require_compatible(params, switching_key, sample)
    except ValueError:
        return False
    return True
