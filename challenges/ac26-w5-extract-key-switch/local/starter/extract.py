"""The only file you edit.

Blind rotation leaves an RLWE ciphertext. Two things still have to happen before it is
useful: one coefficient of it has to come out as an LWE sample, and that sample has to move
to a different key and a different dimension — **without changing what it says**.

You are not rebuilding anything before that. `participant.fhe` supplies the ring, RLWE,
RGSW, the external product, CMUX and the rotation loop, all correct. This problem is the two
steps after.

## Extraction

The phase polynomial is `b - a*s`. Coefficient `k` of it can be written as an LWE phase over
the ring secret's own coefficients:

```text
phase_k = b_k - sum_j c_j * s_j
```

Work out what `c_j` has to be. `(a*s)_k` collects the products `a_i * s_j` whose indices
meet at `k` **in the ring**, and the ring is negacyclic — some of those terms arrive with
their sign flipped. Which ones, and why, is the whole checkpoint.

Note what the extracted sample's secret is: `(s_0, ..., s_(N-1))`, the ring secret read as a
vector. That is not the key the rest of the system uses, which is why the second half of this
problem exists.

## Key switching

Move a sample from `s_old` (dimension `n_old`) to `s_new` (dimension `n_new`). The switching
key holds, for every old index `j` and level `l`:

```text
ksk[j][l] = LWE_(s_new)( B^(L-1-l) * s_old[j] )
```

Decompose the old mask, subtract the matching entries, and read what happens to the phase.
The convention is `ac26-w5-rgsw-external`'s, unchanged: `q = base ** levels`, unsigned,
most-significant weight first, exactly `levels` digits, gadget `(B^(L-1), ..., B, 1)`
descending. That is lecture slide 30's order: with `B = 4`, `L = 3`, `q = 64`,
`decompose(47) == (2, 3, 3)` — `47 = 2*16 + 3*4 + 3*1`. `decompose` is supplied.

You are given **no secret at either end**. Not the ring secret, not the source key, not the
target key. If you find yourself wanting one, the design is telling you something: key
switching is not a decrypt followed by a re-encrypt.

`params` carries `base`, `levels`, `degree`, `dimension`, `target_dimension`, `modulus`,
`plaintext_modulus`, `delta`. They all change between checkpoints. Anything hardcoded is
wrong somewhere — including coefficient index 0, which is the one you will test first.

Run `make inspect` first.

None of this is secure — the parameters are small enough to enumerate and both secrets fall
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

from participant.fhe import decompose, rlwe_phase  # noqa: F401 - the supplied layer


# ---------------------------------------------------------------------------
# The equation extraction has to preserve
# ---------------------------------------------------------------------------


def phase_coefficient(params: dict, ring_key, ciphertext: dict, index: int) -> int:
    """Coefficient `index` of `b - a*s`, computed in the ring.

    The reference the rest of the problem is measured against, and the only function here
    that gets a secret at all. `rlwe_phase(params, secret, ciphertext)` is supplied.

    Reject an index outside the ring.
    """
    return 0


# ---------------------------------------------------------------------------
# Sample extraction
# ---------------------------------------------------------------------------


def extract_sample(params: dict, ciphertext: dict, index: int) -> dict:
    """Return `{"mask": (...), "body": ...}` — coefficient `index` as an LWE sample.

    The mask has `degree` coefficients, one per ring-secret coefficient, and the sample's
    phase has to come out equal to `phase_coefficient` for the same index — exactly, not to
    within a rounding step. Extraction adds no noise and decrypts nothing.

    For each secret index `j` there is exactly one mask coefficient of `a` that pairs with
    it. Find which, and find when the pairing crosses the degree.

    Reject an index outside the ring. Do not special-case index 0.
    """
    return {}


def extract_trace(params: dict, ciphertext: dict, index: int) -> tuple[dict, ...]:
    """One record per extracted mask slot, so the mapping can be read rather than trusted.

    `degree` records. Each one:

    ```text
    target    the extracted mask slot, 0 .. degree-1
    source    which coefficient of `a` it came from
    sign      +1 or -1
    wrapped   whether that pairing crossed the degree
    value     the mask coefficient itself, reduced
    ```

    Reading down `wrapped` should show exactly one boundary, and where it sits is not a
    coincidence.
    """
    return ()


# ---------------------------------------------------------------------------
# Key switching
# ---------------------------------------------------------------------------


def decompose_mask(params: dict, mask) -> tuple[tuple[int, ...], ...]:
    """One digit tuple **per mask coefficient**, most significant first, exactly `levels` of them.

    Watch the shape against `ac26-w5-rgsw-external`. That problem wanted one ring element
    per level, because the external product multiplied a level by a ring element. Here each
    coefficient's digits index into that coefficient's own switching-key entries, so the
    grouping is the other way round.
    """
    return ()


def key_switch(params: dict, switching_key: dict, sample: dict) -> dict:
    """Return `{"mask": (...), "body": ..., "keyId": ...}` under the target key.

    ```text
    switching_key["entries"][j][l]   {"mask": (...target_dimension...), "body": ...}
                                     an LWE encryption under the target key of B^(L-1-l) * source[j]
    switching_key["sourceKeyId"]     which key the input is expected to be under
    switching_key["targetKeyId"]     which key the output lands under
    switching_key["sourceDimension"] / ["targetDimension"] / ["base"] / ["levels"] / ["modulus"]
    ```

    Start from `(0, body)` and subtract. Write down what each subtraction removes from the
    phase and the shape of the answer follows.

    Reject a key that does not match the sample — dimension, parameters, or a `keyId` on the
    sample that names a different source key. Applying it anyway produces a well-formed
    ciphertext that decrypts to noise under both keys, which is worse than an error.

    The result carries the target key's id. It must not carry a secret.
    """
    return {}


def domain_report(params: dict, sample: dict, switching_key: dict) -> dict:
    """Classify which key and dimension each side of the switch lives in.

    ```text
    sourceKeyId       targetKeyId
    sourceDimension   targetDimension
    modulus           base            levels
    compatible        whether this key can switch this sample
    noiseAdded        the switch's noise bound, as a count
    ```

    Decide `compatible` from the declared metadata. There is no other way: neither secret is
    here, so it cannot be settled by trying the switch and seeing whether the result
    decrypts — and a system that settled it that way would need the secrets in the one place
    they must not be.

    `noiseAdded` is the bound, for the same reason: measuring it would take a phase, and a
    phase takes a key. One digit times one entry's noise, over every source index and every
    level, with the digit at most `base - 1`.
    """
    return {}
