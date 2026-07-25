"""The only file you edit.

Problem 510 put one message on one ring and asked how far it could be pushed. This one
builds the two objects that actually carry a message that way, and they are the same object
twice:

```text
LWE     secret s is a vector of n small integers
        b = <a, s> + encode(m) + e                       (mod q)

RLWE    secret s is a polynomial with N small coefficients
        b = a*s   + encode(m) + e                        in R_q
```

Every scalar in the first line is a polynomial in the second. `<a, s>` becomes `a*s`, one
message becomes N of them, one noise value becomes N. The phase — what is left once the
secret cancels — is `encode(m) + e` either way, and decoding it is problem 510's rule,
unchanged.

The ring is `R_q = Z_q[X] / (X^N + 1)`. **Note the plus.** `X^N = -1`, so a coefficient that
walks off the top of the ring comes back with its sign flipped. Reducing indices with `% N`
instead gives a different ring, one that decrypts a great many samples correctly.

`p`, `delta`, `q`, `degree` (N) and `dimension` (n) all come from `params` and change between
checkpoints. `degree` and `dimension` are usually different numbers; anything you hardcode is
wrong somewhere.

Four things are easy to get wrong and all four are graded:

  * **The fold's sign is periodic, not a threshold.** Degree N lands on degree 0 negated.
    Degree 2N lands on degree 0 *positive*. A product of two polynomials never produces an
    index that high, so nothing in the encryption path will tell you which one you wrote.

  * **The phase subtracts.** `b + <a, s>` is a well-defined number that decodes to the right
    message whenever the inner product happens to be a multiple of the scaling.

  * **Every RLWE coefficient carries its own message and spends its own budget.** A
    polynomial survives the noise when every coefficient does — not when the sum, the mean,
    or the magnitude is comfortable.

  * **Secrets are ternary.** Coefficients are in `{-1, 0, 1}`, so they really are negative.
    Python's `%` returns a non-negative result for a positive modulus, so that needs no
    special case — but it does mean the reduction is doing work rather than tidying up.

Run `make inspect` first. It prints the ring, a worked LWE sample, a worked RLWE sample side
by side, and a pair of polynomials the two multiplication rules disagree about.

None of this is secure. q is small enough to enumerate and the secret is short enough to
search, which is the only reason the intermediate values are printable at all.
"""

from __future__ import annotations

# --------------------------------------------------------------------------------------
# Given: problem 510's answer, already written. These are not graded here. You will need
# all four, and you should not need to change any of them.
# --------------------------------------------------------------------------------------


def encode(params: dict, m: int) -> int:
    """The encoding point for message m, as a ring element in [0, q)."""
    return (m % params["p"]) * params["delta"] % params["q"]


def decode(params: dict, c: int) -> int:
    """The message whose encoding point c is nearest to. Ties round up."""
    delta = params["delta"]
    return ((c % params["q"]) + delta // 2) // delta % params["p"]


def centered(params: dict, x: int) -> int:
    """The representative of x in [-(q // 2), (q - 1) // 2]."""
    q = params["q"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


def noise_interval(params: dict) -> tuple[int, int]:
    """The inclusive range of noise one coefficient tolerates. Not symmetric."""
    delta = params["delta"]
    return (-(delta // 2), delta - delta // 2 - 1)


# --------------------------------------------------------------------------------------
# The ring.
# --------------------------------------------------------------------------------------


def normalize(params: dict, coefficients) -> tuple[int, ...]:
    """The canonical element of R_q for any integer sequence, of any length.

    Return exactly `params["degree"]` coefficients, each in [0, q). The input may be longer
    than that, shorter than that, or full of negative numbers.

    Work out what happens to index 2N before you write the sign rule. A convolution of two
    ring elements never reaches that far, so the encryption path will not tell you.
    """
    return ()


def ring_add(params: dict, f, g) -> tuple[int, ...]:
    """f + g in R_q."""
    return ()


def ring_sub(params: dict, f, g) -> tuple[int, ...]:
    """f - g in R_q."""
    return ()


def ring_mul(params: dict, f, g) -> tuple[int, ...]:
    """f * g in R_q.

    The convolution is ordinary. What makes the ring negacyclic is what happens to the part
    of the result sitting above degree N, and that part is not thrown away.
    """
    return ()


# --------------------------------------------------------------------------------------
# LWE, and then the same three terms one dimension up.
# --------------------------------------------------------------------------------------


def lwe_encrypt(params: dict, secret, message: int, mask, error: int) -> tuple:
    """Return the ciphertext `(mask, body)`.

    The mask and the noise are handed in rather than drawn, so the whole thing is
    reproducible. Return the mask reduced into [0, q) — a ciphertext leaving this function
    should already be canonical.
    """
    return ((), 0)


def lwe_phase(params: dict, secret, ciphertext) -> int:
    """What is left of the body once the secret cancels, reduced into [0, q)."""
    return 0


def lwe_decrypt(params: dict, secret, ciphertext) -> int:
    """The message. One line, once `lwe_phase` is right."""
    return 0


def rlwe_encrypt(params: dict, secret, message, mask, error) -> tuple:
    """Return the ciphertext `(mask, body)`, both canonical ring elements.

    `message` is N messages and `error` is N noise coefficients. Encoding only the constant
    term is the natural half-step up from LWE; work out what the other N-1 coefficients
    decode to if you take it.
    """
    return ((), ())


def rlwe_phase(params: dict, secret, ciphertext) -> tuple[int, ...]:
    """The phase, as a ring element."""
    return ()


def rlwe_decrypt(params: dict, secret, ciphertext) -> tuple[int, ...]:
    """The N messages."""
    return ()


def phase_coefficient_terms(params: dict, mask, k: int) -> tuple[int, ...]:
    """The vector `v` with `<v, s> = (mask * s)[k]` for **every** secret `s`.

    This is the correspondence, stated precisely. Write out coefficient k of a product by
    hand for a small N and read off which entry of the mask pairs with `s[j]` — and which of
    those entries got there by walking past degree N.

    Return it reduced into [0, q), like everything else.
    """
    return ()


# --------------------------------------------------------------------------------------
# The budget, generalized.
# --------------------------------------------------------------------------------------


def survives(params: dict, error) -> bool:
    """Whether the message still comes back, given this noise.

    `error` is an int (one coefficient's worth) or a sequence (a whole polynomial's). Decide
    what makes a polynomial survive before you write it — it is not the sum.
    """
    return False


def first_failing_index(params: dict, samples) -> int:
    """The index of the first sample in `samples` that does not survive, or -1 if none do."""
    return 0


def validate_ciphertext(params: dict, mode: str, ciphertext) -> list[str]:
    """Reasons this object cannot be a ciphertext of that kind, empty when it can.

    `mode` is `"lwe"` or `"rlwe"`; anything else is itself a reason. The two shapes differ in
    more than a length — look at what the body is in each.

    Canonical means every coefficient is already in [0, q). Decide what that says about q
    itself before you write the bound.
    """
    return []
