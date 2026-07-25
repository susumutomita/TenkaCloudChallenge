"""The only file you edit.

Week 5's five problems each built one piece. All five are **supplied** here, correct and
finished: the ring and the encoding, LWE and RLWE, the gadget and the external product, CMUX
and monomial rotation, sample extraction and key switching. You are not rebuilding any of
them.

What is missing is the thing they were pieces of. Chaining them turns an encrypted bit into
`f` of that encrypted bit, under a fresh key, ready to be used again — and then one gate
falls out of it almost for free.

## The encoding changed, and that is the point

```text
encode(1) =  q/8        encode(0) = -q/8        decode(c) = 1 if centered(c) > 0
```

Balanced, not `m * delta`. Under it, decoding **is** a sign test — and a sign test is what
negacyclic rotation computes for free, because `X^N = -1` negates whatever wraps past the
degree. The earlier problems' encoding cannot express that. If you have ever wondered why
PBS cannot just evaluate any function you like, this is the concrete answer: the function has
to survive being written into a polynomial that the rotation reads with a sign.

## The pipeline

```text
LWE(dimension n, key s_lwe)
  -> rotation domain      scale by 2N/q and round
  -> LUT accumulator      a trivial RLWE ciphertext: no mask, no noise, no message
  -> blind rotation       X^(-phase) * accumulator, phase never computed
  -> RLWE(ring key)
  -> sample extraction    coefficient 0, at dimension N under the ring key
  -> key switching        back to dimension n under s_lwe
  -> LWE(dimension n, key s_lwe)
```

The output key is the **input** key. That is what makes this bootstrapping rather than a
one-way evaluation, and it is checked: the hidden tests bootstrap the output of a bootstrap.

## Every stage stamps where its numbers live

```text
kind             "lwe" or "rlwe"
keyId            which secret it is a ciphertext under
dimension        how many mask coefficients that secret has
modulus          which ring of integers the numbers are in
parameterSetId   which parameter set they belong to
noiseBound       what the stage can have added, as a bound
```

Two of those change mid-pipeline. Extraction moves the ciphertext to the **ring** secret at
dimension `degree`; the key switch moves it back. A stage that returns the right numbers
under the wrong label has produced something the next stage will happily combine with a
ciphertext it does not match, and the result decrypts to noise under both keys. Each is
graded, and each is a decision rather than bookkeeping.

## What you are given

`fixtures.generate` supplies `encode`, `normalize`, `cmux`, `rotate_ciphertext`,
`extract_sample`, `key_switch`, `blind_rotation_noise`, `key_switch_noise`, `lwe_digest` and
`rlwe_digest`. No secret key is passed to anything you write, at either end — so if you find
yourself wanting to decrypt something, the design is telling you that the step you are
reaching for is not the step you need.

`params` carries `base`, `levels`, `degree`, `dimension`, `modulus`, `plaintext_modulus`,
`delta`, `parameterSetId`, `encodingId`. They all change between checkpoints. Anything
hardcoded is wrong somewhere.

Run `make inspect` first.

None of this is secure. The parameters are small enough to enumerate and both secrets fall
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

from fixtures.generate import (  # noqa: F401 - the supplied Week 5 stack
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

    `table` is `{0: f(0), 1: f(1)}`. Return `{"a": ..., "b": ...}` plus the envelope.

    Work out where a bit lands. A message encoded as `+-q/8` has a phase of `+-q/8`, which
    in rotation units (`2N/q` per unit) is `N/4` for 1 and `7N/4` for 0. Blind rotation puts
    the coefficient at that position into coefficient 0 — **negated** if the position was in
    the upper half of the ring.

    So the lower half of the table is reached directly and the upper half through a negation.
    Write `f(0)` into the upper half unchanged and every function whose two outputs differ
    comes out inverted for `m = 0`. That is half the truth table, and it looks like a sign
    bug anywhere else in the pipeline.

    Trivial means trivial: no mask, no noise, and no message of its own. It carries the
    *function*. Nothing downstream knows which function it is evaluating, which is worth
    noticing — the same rotation, extraction and switch serve every `f`.
    """
    return {}


# ---------------------------------------------------------------------------
# 2. The input, in rotation units
# ---------------------------------------------------------------------------


def to_rotation_domain(params: dict, sample: dict) -> dict:
    """Rescale every component of an LWE sample from `Z_q` to `Z_2N`.

    A rotation exponent has to be an integer in `[0, 2N)` — that is how many distinct
    monomials the ring has. Round to nearest, not down: truncating doubles the worst-case
    error per component and biases it one way.

    The key does not change here. The modulus does, and so does `noiseBound`: each rounding
    costs up to half a unit and there is one per mask coefficient plus one for the body.
    That total is this stage's entire contribution, and `correctness_bound` spends it before
    anything else runs.
    """
    return {}


# ---------------------------------------------------------------------------
# 3. Blind rotation
# ---------------------------------------------------------------------------


def blind_rotate(params: dict, bootstrap_key, rotated: dict, accumulator: dict) -> dict:
    """`X^(-phase) * accumulator`, without the phase ever being computed.

    `bootstrap_key[i]` is an RGSW encryption of the LWE secret's bit `i`. `cmux` is supplied:
    `cmux(params, rgsw, ct0, ct1)` returns `ct0` when the selector bit is 0 and `ct1` when it
    is 1, and cannot tell you which it returned.

    Start somewhere that accounts for the body, then walk the mask. Each step chooses,
    under encryption, between leaving the accumulator alone and turning it by `a_i`. Write
    down the total exponent as a sum over the chosen steps and it should come out as
    `-(body - <mask, s>)`.

    Two things here are easy to get backwards and neither announces itself: which of `cmux`'s
    two arguments is the rotated one, and the sign on the body. Both produce well-formed
    ciphertexts rotated by a plausible amount.

    Run the CMUX loop in index order — the hidden tests check the artifact, not just the
    coefficient it lands on, and rotations composed in another order carry different noise.
    """
    return {}


# ---------------------------------------------------------------------------
# 4. Sample extraction
# ---------------------------------------------------------------------------


def extract(params: dict, rotated: dict) -> dict:
    """One coefficient of the rotated accumulator, as an LWE sample.

    `extract_sample(params, ciphertext, index)` is supplied and adds no noise. Which index
    is the question: the rotation was by `-phase`, so exactly one coefficient now holds
    `TV[phase]`, and every other one holds a value of `f` for an input that was not encrypted.

    The relabelling is not cosmetic. What comes out is a ciphertext under the **ring** secret
    read as a vector, at dimension `degree` — a different key and a different length from
    what went in. Leave the input's `keyId` on it and the next stage applies a switching key
    built for a different secret.
    """
    return {}


# ---------------------------------------------------------------------------
# 5. Key switching
# ---------------------------------------------------------------------------


def switch(params: dict, switching_key: dict, sample: dict) -> dict:
    """Back to the LWE key and dimension the input arrived under.

    ```text
    switching_key["entries"][j][l]    an LWE encryption under the target key of B^l * source[j]
    switching_key["sourceKeyId"]      which key the input is expected to be under
    switching_key["targetKeyId"]      which key the output lands under
    switching_key["sourceDimension"] / ["targetDimension"] / ["base"] / ["levels"] / ["modulus"]
    ```

    `key_switch(params, switching_key, sample)` is supplied. Refuse a key that does not match
    the sample — dimension, parameters, or a `keyId` naming a different source. Applying it
    anyway produces a well-formed ciphertext that decrypts to noise under both keys, which is
    worse than an error.

    Note which key the target is, and why it is that one. If the output landed under some
    other secret it could not be fed back in, and everything after the first gate in a
    circuit would be impossible.
    """
    return {}


# ---------------------------------------------------------------------------
# 6. The whole thing
# ---------------------------------------------------------------------------


def bootstrap(
    params: dict, bootstrap_key, switching_key: dict, sample: dict, table: dict
) -> dict:
    """Programmable bootstrapping: `Dec(bootstrap(Enc(m), f)) = f(m)`.

    Four of your stages, in one order. The accumulator's key id is the switching key's
    *source*, because that is the domain the rotation happens in.

    Nothing here is handed a secret. `f` is evaluated on an encrypted message without the
    message ever existing in the clear — which is a different claim from "the answer came out
    right", and the one the problem is about.
    """
    return {}


# ---------------------------------------------------------------------------
# 7. What the pipeline did, and what it refreshed
# ---------------------------------------------------------------------------


def pipeline_trace(
    params: dict, bootstrap_key, switching_key: dict, sample: dict, table: dict
) -> tuple[dict, ...]:
    """One record per stage, in pipeline order. Six of them.

    ```text
    stage            input | rotation-domain | accumulator | blind-rotation | extraction | key-switch
    kind             "lwe" or "rlwe"
    keyId            which secret this artifact is under
    dimension        modulus            parameterSetId
    noiseBound       what this stage can have added
    carriesMessage   whether this artifact carries the message at all
    messageIs        "m" or "f(m)", and None when it carries none
    located          "whole" or "coefficient-0", and None when it carries none
    digest           lwe_digest(...) or rlwe_digest(params, ...) of the artifact produced
    ```

    The `input` row's bound is `correctness_bound` — the most it is allowed to carry, rather
    than what it does carry; measuring what it carries would take a key.

    Two columns are worth reading down rather than filling in. `noiseBound` stops depending
    on the input somewhere — find where, and that is the refresh. `carriesMessage` is False
    exactly once, and which row that is answers "what is a lookup table, as a ciphertext".

    The digests are what make this a record of a run rather than a diagram of one.
    """
    return ()


def output_noise_bound(params: dict) -> int:
    """What a bootstrapped ciphertext carries, whatever went in.

    `blind_rotation_noise` and `key_switch_noise` are supplied; the accumulator is trivial
    and extraction adds nothing. The input's noise is not a term in this sum, and that
    absence is the whole of the refresh.
    """
    return 0


def correctness_bound(params: dict) -> int:
    """The most input noise a bootstrap tolerates, in `Z_q`.

    A phase decodes correctly while it stays on its own side of 0 and `q/2`, which is `N/4`
    rotation-domain units away from where it sits. The domain switch has already spent some
    of that on rounding. Convert what is left back to `Z_q`.

    Above this the bootstrap does not degrade — it returns the *other* bit, confidently, with
    a fresh small noise. That is the failure mode worth remembering.
    """
    return 0


def refresh_report(params: dict, input_noise: int) -> dict:
    """The correctness contract for one input, and what comes out regardless.

    ```text
    inputNoise         what was handed in
    correctnessBound   the most this parameter set tolerates
    outputNoiseBound   what comes out
    withinContract     whether this input is inside the contract at all
    secondPassFits     whether the output can itself be bootstrapped
    ```

    `outputNoiseBound` must not vary with `inputNoise`. Read it twice with different inputs
    and the number is the same — which is exactly why `secondPassFits` can be true.
    """
    return {}


# ---------------------------------------------------------------------------
# 8. NAND, before the bootstrap
# ---------------------------------------------------------------------------


def nand_combine(params: dict, left: dict, right: dict) -> dict:
    """One linear combination of the two encrypted bits, and no gate anywhere.

    You want a phase that is positive exactly when NAND is 1, because the balanced encoding
    made "positive" and "decodes to 1" the same thing. Write out the four phases you want in
    units of `q/8`, then find the combination of `phase_left` and `phase_right` that produces
    them. It has one constant term and two subtractions.

    Check what happens to `(0,1)` and `(1,0)` if you leave the constant out. Those two rows
    then land exactly on the decision boundary, where the answer is settled by which way the
    noise fell — measured over 40 seeds, roughly one attempt in seven at those two rows comes
    out wrong, and the other two rows never do. A bug that fails one row in seven reads as
    flakiness rather than as a missing term.

    Both inputs have to be under the same key. Adding ciphertexts under different secrets
    produces a well-formed ciphertext of nothing.
    """
    return {}


# ---------------------------------------------------------------------------
# 9. HomNAND
# ---------------------------------------------------------------------------


def homomorphic_nand(
    params: dict, bootstrap_key, switching_key: dict, left: dict, right: dict
) -> dict:
    """The combination, then one bootstrap. That is the entire gate.

    Which lookup table? Think about what the combination has already done and what is left
    for the bootstrap to decide. The answer is shorter than it looks, and worth sitting with:
    the gate is not in the lookup.

    No plaintext NAND anywhere, and nothing decrypted. The output is a fresh encrypted bit
    under the same key as the inputs, so it can be an input to the next gate.
    """
    return {}
