"""Reference implementation. Lives inside the image only; never mounted to the host.

Used by two things: the mutation suite (which breaks copies of this file and asserts the
hidden tests catch each break), and the `reference-test` CI target.

Every function reads `params`. Nothing hardcodes a modulus or a scaling factor, because
the `transfer` checkpoint runs the whole file under a parameter set derived from a
different seed -- and because a hardcoded `delta` is one of the mutations.
"""

from __future__ import annotations


def validate_params(params: dict) -> list[str]:
    """Reasons this parameter set cannot be used, empty when it can.

    The interesting rule is the last one. `q = p * delta` is not a convention that could
    have gone another way: it is what makes the p encoding points tile the ring evenly,
    and without it the gap between the last point and the wrap-around differs from every
    other gap, so "the tolerated noise interval" is not one interval.

    The `delta >= 1` bound is defence in depth rather than load-bearing: `q = p * delta`
    with `q >= 1` and `p >= 2` already forces it, so relaxing that bound changes no
    verdict on any input. Which is why it does not appear in the mutation suite -- an
    unkillable mutation there would teach that a SURVIVED line can be ignored.
    """
    failures: list[str] = []
    p, delta, q = params.get("p"), params.get("delta"), params.get("q")
    if not isinstance(p, int) or isinstance(p, bool) or p < 2:
        failures.append("p must be an integer of at least 2")
    if not isinstance(delta, int) or isinstance(delta, bool) or delta < 1:
        failures.append("delta must be a positive integer")
    if not isinstance(q, int) or isinstance(q, bool) or q < 1:
        failures.append("q must be a positive integer")
    if not failures and q != p * delta:
        failures.append("q must equal p * delta, or the encoding points do not tile the ring")
    return failures


def encode(params: dict, m: int) -> int:
    """The encoding point for message m, normalized into [0, q).

    `m % p` first: a message outside the space is reduced rather than rejected, which is
    what makes `decode(encode(m)) == m % p` hold for every integer. That reduction is
    presentational -- `(m % p) * delta` and `m * delta` are congruent modulo `p * delta`
    for every integer m, so it says what is meant without changing the result. The outer
    `% q` is the one doing work, and it is the one the mutation suite breaks.
    """
    return (m % params["p"]) * params["delta"] % params["q"]


def centered(params: dict, x: int) -> int:
    """The representative of x in [-(q // 2), (q - 1) // 2].

    The half-way point q/2 belongs to the negative side, matching `decode`'s tie rule.
    Picking the other convention here and this one there would make the two disagree on
    exactly one value per ring, which is the kind of bug that survives every test written
    from a worked example.
    """
    q = params["q"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


def add_noise(params: dict, c: int, e: int) -> int:
    """c + e, reduced into [0, q).

    Python's `%` already returns a non-negative result for a positive modulus, so a
    negative `e` needs no special handling. Taking the absolute value of the noise, or
    skipping the reduction, are both mutations.
    """
    return (c + e) % params["q"]


def decode(params: dict, c: int) -> int:
    """The message nearest to c, ties rounding up.

    `(c + delta // 2) // delta` is nearest-rounding written with integer arithmetic, and
    the trailing `% p` is what makes the ring wrap: the point just past the last message
    is message 0, not message p.
    """
    delta = params["delta"]
    return ((c % params["q"]) + delta // 2) // delta % params["p"]


def success_interval(params: dict) -> tuple[int, int]:
    """The inclusive range of noise over which every message still decodes.

    Derived, not measured, and **not** symmetric. With `delta` even the exact half-way
    point rounds up onto the next message, so the upper end is `delta // 2 - 1` rather
    than `delta // 2`. With `delta` odd there is no exact half-way point and the interval
    is symmetric. Both cases come out of the same expression, which is the reason to
    write it this way rather than branch on the parity.
    """
    delta = params["delta"]
    return (-(delta // 2), delta - delta // 2 - 1)


def first_failure(params: dict, m: int, direction: int) -> tuple[int, int]:
    """The first noise in `direction` that decodes to something other than m.

    Returned as `(noise, decoded)`. `decoded` is taken modulo p, so the failure above the
    largest message is 0 and the failure below message 0 is p - 1. Reporting `m + 1` and
    `m - 1` without that wrap is right for every message except the two that matter.
    """
    low, high = success_interval(params)
    noise = high + 1 if direction > 0 else low - 1
    return (noise, decode(params, add_noise(params, encode(params, m), noise)))
