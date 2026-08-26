"""Reference implementation. Lives inside the image only; not bind-mounted.

Used by two things: the mutation suite (which breaks copies of this file and asserts the
hidden tests catch each break), and the `reference-test` CI target.

Five problems' worth of machinery is supplied by `fixtures.generate` and none of it is
rebuilt here: the ring and the encoding, LWE and RLWE, the gadget and the external product,
CMUX and monomial rotation, sample extraction and key switching. This file is the pipeline
that chains them and the gate it evaluates.

Nothing hardcodes a degree, a dimension, a base or a level count, because `transfer` runs
the whole file under parameters derived from a different seed.

## The artifact envelope

Every stage returns its numbers **plus** where they live:

```text
kind             "lwe" or "rlwe"
keyId            which secret it is a ciphertext under
dimension        how many mask coefficients that secret has
modulus          which ring of integers the numbers are in
parameterSetId   which parameter set they belong to
noiseBound       what the stage can have added, as a bound
```

Two of those change mid-pipeline and changing them is the work: extraction moves the
ciphertext to the **ring** secret at dimension `degree`, and the key switch moves it back.
A stage that returns the right numbers under the wrong label has produced something the
next stage will combine with a ciphertext it does not match, silently.
"""

from __future__ import annotations

from participant.fhe import (
    blind_rotation_noise,
    cmux,
    encode,
    extract_sample,
    key_switch,
    key_switch_noise,
    lwe_digest,
    normalize,
    rlwe_digest,
    rotate_ciphertext,
)


# ---------------------------------------------------------------------------
# 1. The lookup table, as an accumulator
# ---------------------------------------------------------------------------


def lookup_accumulator(params: dict, table: dict, ring_key_id: str) -> dict:
    """The trivial RLWE ciphertext whose coefficients encode `f`.

    Blind rotation leaves `TV[phase]` at coefficient 0, negated when the phase passed the
    degree. A bit encoded as `+-q/8` lands at `N/4` for 1 and `7N/4` for 0, so the lower
    half is reached by `m = 1` directly and the upper half by `m = 0` **through the
    negation**:

    ```text
    TV[k] = encode(f(1))       k in [0, N/2)
    TV[k] = encode(1 - f(0))   k in [N/2, N)
    ```

    The `1 - f(0)` is that negation being undone. The encoding is balanced, so `-encode(x)`
    is `encode(1 - x)` -- write `encode(f(0))` in the upper half instead and every function
    whose two outputs differ comes out inverted for `m = 0`, which is exactly half the truth
    table and looks like a sign bug anywhere else in the pipeline.

    A trivial ciphertext: mask zero, no noise, and no message of its own. It carries the
    *function*. Which function is a property of this accumulator alone -- nothing downstream
    knows or needs to know which one it is evaluating.
    """
    degree = params["degree"]
    coefficients = [
        encode(params, table[1]) if k < degree // 2 else encode(params, 1 - table[0])
        for k in range(degree)
    ]
    return {
        "a": tuple([0] * degree),
        "b": normalize(params, coefficients),
        "kind": "rlwe",
        "keyId": ring_key_id,
        "dimension": degree,
        "modulus": params["modulus"],
        "parameterSetId": params["parameterSetId"],
        "noiseBound": 0,
    }


# ---------------------------------------------------------------------------
# 2. The input, in rotation units
# ---------------------------------------------------------------------------


def to_rotation_domain(params: dict, sample: dict) -> dict:
    """Rescale every component from `Z_q` to `Z_2N`, rounding to nearest.

    The rotation exponent has to be an integer in `[0, 2N)` because that is how many
    distinct monomials the ring has. Truncating instead of rounding doubles the worst-case
    error per component and biases it one way, which is what eats the correctness budget.

    Each rounding costs up to half a unit, and there are `dimension + 1` of them -- one per
    mask coefficient and one for the body. That total is this stage's whole noise
    contribution and it is what `correctness_bound` spends before anything else runs.

    The key does not change here. The modulus does.
    """
    modulus, q = 2 * params["degree"], params["modulus"]

    def scaled(value: int) -> int:
        return ((value % q) * modulus + q // 2) // q % modulus

    return {
        "mask": tuple(scaled(a) for a in sample["mask"]),
        "body": scaled(sample["body"]),
        "kind": "lwe",
        "keyId": sample["keyId"],
        "dimension": params["dimension"],
        "modulus": modulus,
        "parameterSetId": params["parameterSetId"],
        "noiseBound": (params["dimension"] + 1) // 2,
    }


# ---------------------------------------------------------------------------
# 3. Blind rotation
# ---------------------------------------------------------------------------


def blind_rotate(params: dict, bootstrap_key, rotated: dict, accumulator: dict) -> dict:
    """`X^(-phase) * accumulator`, without the phase ever being computed.

    Start at `X^(-body) * accumulator`, then for each mask coefficient CMUX between leaving
    it alone and rotating by `a_i`. The bootstrapping key's `i`-th entry is an RGSW
    encryption of `s_i`, so the selection happens under encryption: the total rotation comes
    out as `-(body - <mask, s>)`, which is `-phase`, and nothing here knows what that is.

    The order of the CMUX arguments is the whole checkpoint. `cmux(par, rgsw, ct0, ct1)`
    returns `ct0` when the selector is 0, so the *unrotated* accumulator is `ct0` and the
    rotated one is `ct1`. Swap them and every secret bit is read inverted -- which still
    produces a well-formed ciphertext, still rotates by a plausible amount, and is wrong.

    The sign on the body is the other half. `X^(-phase)` brings coefficient `phase` down to
    coefficient 0; `X^(+phase)` sends coefficient 0 up to `phase` and leaves whatever
    happened to be at `-phase` where the extraction will read.
    """
    current = rotate_ciphertext(params, accumulator, -rotated["body"])
    for index, mask in enumerate(rotated["mask"]):
        current = cmux(
            params, bootstrap_key[index], current, rotate_ciphertext(params, current, mask)
        )
    return {
        "a": current["a"],
        "b": current["b"],
        "kind": "rlwe",
        "keyId": accumulator["keyId"],
        "dimension": params["degree"],
        "modulus": params["modulus"],
        "parameterSetId": params["parameterSetId"],
        "noiseBound": blind_rotation_noise(params),
    }


# ---------------------------------------------------------------------------
# 4. Sample extraction
# ---------------------------------------------------------------------------


def extract(params: dict, rotated: dict) -> dict:
    """Coefficient **0** of the rotated accumulator, as an LWE sample.

    Zero rather than any other index: the rotation was by `-phase`, so it is coefficient 0
    that now holds `TV[phase]`. Every other coefficient holds a value of `f` for some input
    that was not the one encrypted.

    `extract_sample` is supplied and adds no noise -- the extracted phase *is* the
    coefficient. What this stage owns is the relabelling, and it is not cosmetic: the sample
    that comes out is a ciphertext under the **ring** secret read as a vector, at dimension
    `degree`. Leave the input's `keyId` on it and the next stage will apply a switching key
    built for a different secret, which produces a well-formed ciphertext that decrypts to
    noise under both keys.
    """
    sample = extract_sample(params, rotated, 0)
    return {
        "mask": sample["mask"],
        "body": sample["body"],
        "kind": "lwe",
        "keyId": rotated["keyId"],
        "dimension": params["degree"],
        "modulus": params["modulus"],
        "parameterSetId": params["parameterSetId"],
        "noiseBound": rotated["noiseBound"],
    }


# ---------------------------------------------------------------------------
# 5. Key switching
# ---------------------------------------------------------------------------


def switch(params: dict, switching_key: dict, sample: dict) -> dict:
    """Back to the LWE secret and dimension the input arrived under.

    `key_switch` is supplied. What this stage owns is refusing to apply a key that does not
    match the sample, and stamping the domain the result now lives in.

    The target key being the *input's* key is what makes this bootstrapping rather than a
    one-way evaluation: the output is a ciphertext of the same kind as the input, under the
    same secret, so it can be fed back in. A pipeline that landed somewhere else would be
    correct once and composable never.
    """
    _require_compatible(params, switching_key, sample)
    switched = key_switch(params, switching_key, sample)
    return {
        "mask": switched["mask"],
        "body": switched["body"],
        "kind": "lwe",
        "keyId": switching_key["targetKeyId"],
        "dimension": switching_key["targetDimension"],
        "modulus": params["modulus"],
        "parameterSetId": params["parameterSetId"],
        "noiseBound": sample["noiseBound"] + key_switch_noise(params),
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


# ---------------------------------------------------------------------------
# 6. The whole thing
# ---------------------------------------------------------------------------


def bootstrap(
    params: dict, bootstrap_key, switching_key: dict, sample: dict, table: dict
) -> dict:
    """Programmable bootstrapping: `Dec(bootstrap(Enc(m), f)) = f(m)`.

    Four stages, in one order. The output is under the same key at the same dimension as the
    input, which is the property that lets the result be bootstrapped again -- and the reason
    the noise bound below does not mention the input's.

    Nothing in here is given a secret. `f` is evaluated on an encrypted message without the
    message ever existing in the clear, which is the claim the whole problem is about and is
    not the same claim as "the answer came out right".
    """
    accumulator = lookup_accumulator(params, table, switching_key["sourceKeyId"])
    rotated = blind_rotate(params, bootstrap_key, to_rotation_domain(params, sample), accumulator)
    return switch(params, switching_key, extract(params, rotated))


# ---------------------------------------------------------------------------
# 7. What the pipeline did, and what it refreshed
# ---------------------------------------------------------------------------


def pipeline_trace(
    params: dict, bootstrap_key, switching_key: dict, sample: dict, table: dict
) -> tuple[dict, ...]:
    """One record per stage, naming the artifact it produced by digest.

    Six rows in pipeline order. The digests make this a record of a run rather than a
    diagram of one: they cannot be filled in from the final answer, so a trace that agrees
    with the reference is a trace whose stages actually ran.

    Read down `noiseBound` and note where it stops depending on what came in -- at
    `blind-rotation`. That is the refresh. The accumulator carries no noise because it is
    trivial, extraction adds none, and the key switch adds its own; the input's contribution
    appears in no row after the second.

    Read down `carriesMessage` for the other half. The accumulator is the one artifact
    carrying no message at all; it carries the function.
    """
    accumulator = lookup_accumulator(params, table, switching_key["sourceKeyId"])
    rotated_sample = to_rotation_domain(params, sample)
    rotated = blind_rotate(params, bootstrap_key, rotated_sample, accumulator)
    extracted = extract(params, rotated)
    switched = switch(params, switching_key, extracted)

    target = switching_key["targetKeyId"]
    return (
        _row(params, "input", "lwe", target, params["dimension"], params["modulus"],
             correctness_bound(params), True, "m", "whole", lwe_digest(sample)),
        _row(params, "rotation-domain", "lwe", target, params["dimension"],
             rotated_sample["modulus"], rotated_sample["noiseBound"], True, "m", "whole",
             lwe_digest(rotated_sample)),
        _row(params, "accumulator", "rlwe", accumulator["keyId"], params["degree"],
             params["modulus"], 0, False, None, None, rlwe_digest(params, accumulator)),
        _row(params, "blind-rotation", "rlwe", rotated["keyId"], params["degree"],
             params["modulus"], blind_rotation_noise(params), True, "f(m)", "coefficient-0",
             rlwe_digest(params, rotated)),
        _row(params, "extraction", "lwe", extracted["keyId"], params["degree"],
             params["modulus"], blind_rotation_noise(params), True, "f(m)", "whole",
             lwe_digest(extracted)),
        _row(params, "key-switch", "lwe", target, params["dimension"], params["modulus"],
             output_noise_bound(params), True, "f(m)", "whole", lwe_digest(switched)),
    )


def _row(
    params: dict, stage: str, kind: str, key_id: str, dimension: int, modulus: int,
    bound: int, carries: bool, message, located, fingerprint: str,
) -> dict:
    return {
        "stage": stage,
        "kind": kind,
        "keyId": key_id,
        "dimension": dimension,
        "modulus": modulus,
        "parameterSetId": params["parameterSetId"],
        "noiseBound": bound,
        "carriesMessage": carries,
        "messageIs": message,
        "located": located,
        "digest": fingerprint,
    }


def output_noise_bound(params: dict) -> int:
    """What a bootstrapped ciphertext carries, whatever went in.

    Blind rotation's contribution plus the key switch's. The input's noise is not a term --
    that absence is the refresh, and it is why the bound is a constant of the parameter set
    rather than a function of the ciphertext.
    """
    return blind_rotation_noise(params) + key_switch_noise(params)


def correctness_bound(params: dict) -> int:
    """The most input noise a bootstrap tolerates, in `Z_q`.

    A phase decodes correctly while it stays on its own side of 0 and `q/2`, which is `N/4`
    rotation-domain units away from where it sits. The domain switch spends up to
    `(n + 1) / 2` of those on rounding, and what is left converts back at `q / 2N` per unit.

    Above this the bootstrap does not degrade -- it returns the *other* bit, confidently and
    with a fresh small noise. That is the failure mode worth remembering: a correct-looking
    ciphertext of the wrong answer.
    """
    spare = params["degree"] // 4 - (params["dimension"] + 1) / 2
    return int(spare * params["modulus"] / (2 * params["degree"]))


def refresh_report(params: dict, input_noise: int) -> dict:
    """The correctness contract for one input, and what comes out regardless.

    `outputNoiseBound` does not mention `input_noise` and must not vary with it. Read it
    twice with different inputs and the number is the same -- which is why a bootstrapped
    ciphertext can be bootstrapped again, and `secondPassFits` says whether it actually can
    at these parameters.
    """
    return {
        "inputNoise": input_noise,
        "correctnessBound": correctness_bound(params),
        "outputNoiseBound": output_noise_bound(params),
        "withinContract": abs(input_noise) <= correctness_bound(params),
        "secondPassFits": 2 * output_noise_bound(params) <= correctness_bound(params),
    }


# ---------------------------------------------------------------------------
# 8. NAND, before the bootstrap
# ---------------------------------------------------------------------------


def nand_combine(params: dict, left: dict, right: dict) -> dict:
    """`(0, q/8) - left - right`, which is one linear combination and no gate.

    The phase that comes out is `q/8 - phase_left - phase_right`, so for the four input
    pairs, in units of `q/8`:

    ```text
    (0,0)  1 + 1 + 1 =  3      (0,1)  1 + 1 - 1 =  1
    (1,0)  1 - 1 + 1 =  1      (1,1)  1 - 1 - 1 = -1
    ```

    Positive exactly when NAND is 1. The gate has become a sign test, and the balanced
    encoding is what made a sign test the same thing as decoding.

    The offset is what separates the two cases. Drop it and the four phases are `2, 0, 0,
    -2` -- `(0,1)` and `(1,0)` land exactly on the decision boundary, where the answer is
    decided by the noise. Measured over 40 seeds, 12 of the 80 attempts at those two rows
    come out wrong and the other two rows never do: a missing constant that fails one row in
    seven reads as flakiness rather than as a bug.

    Both inputs must be under the same key. Adding ciphertexts under different secrets
    produces a well-formed ciphertext of nothing.
    """
    if left.get("keyId") != right.get("keyId"):
        raise ValueError("the two bits are not under the same key")
    modulus = params["modulus"]
    return {
        "mask": tuple((-x - y) % modulus for x, y in zip(left["mask"], right["mask"])),
        "body": (params["delta"] - left["body"] - right["body"]) % modulus,
        "kind": "lwe",
        "keyId": left["keyId"],
        "dimension": params["dimension"],
        "modulus": modulus,
        "parameterSetId": params["parameterSetId"],
        "noiseBound": left.get("noiseBound", 0) + right.get("noiseBound", 0),
    }


# ---------------------------------------------------------------------------
# 9. HomNAND
# ---------------------------------------------------------------------------


def homomorphic_nand(
    params: dict, bootstrap_key, switching_key: dict, left: dict, right: dict
) -> dict:
    """One linear combination, then one bootstrap with the identity table.

    Not a plaintext NAND anywhere, and not a table lookup on two bits either: the identity
    table is `{0: 0, 1: 1}`, and every input pair produces the same table. What distinguishes
    the four rows is the phase the combination produced, and the bootstrap only decides which
    side of zero it is on.

    That the table is the identity is worth sitting with. The gate is not in the lookup. It
    is in the linear combination, and the bootstrap is there to turn the answer back into a
    fresh ciphertext that can be used again.
    """
    return bootstrap(
        params, bootstrap_key, switching_key, nand_combine(params, left, right), {0: 0, 1: 1}
    )
