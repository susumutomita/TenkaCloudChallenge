"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from "Inspect evidence". If you cannot open Python, fill in these functions in the
Portal editor instead and press "Run public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. p is the
plaintext modulus, q the ciphertext modulus, n the ring degree (so the rotation space has
2n positions and D = q/p), s the binary secret, a the mask and b the body of one LWE
ciphertext, shift the parameter of the function f(t) = (t + shift) % (p // 2) the test
polynomial evaluates.
"""

from __future__ import annotations


def params(p: int, q: int, n: int) -> tuple:
    """Line 1 — (p, q, n, D): this deployment's four constants, D = q/p."""
    return (p, q, n, q // p)


def phase(q: int, s, a, b: int) -> int:
    """Line 2 — the phase b - a.s mod q: the mask stripped, plaintext and noise left."""
    return (b - sum(x * y for x, y in zip(a, s))) % q


def split(p: int, q: int, s, a, b: int) -> tuple:
    """Line 3 — divmod(phase, D): the plaintext and the noise, seen once for cross-checking."""
    return divmod(phase(q, s, a, b), q // p)


def slots(p: int, n: int) -> int:
    """Line 4 — 2n // p: how many of the ring's 2n positions one plaintext owns."""
    return 2 * n // p


def testvector(p: int, n: int, shift: int) -> list:
    """Line 5 (part 1) — the test polynomial: f(m) written out in slot-wide runs.

    The runs are shifted back by half a slot so a plaintext's target position lands in
    the MIDDLE of its run, not on its first coefficient — the mask and body are rounded
    separately in line 6, and the middle is what absorbs those errors.
    """
    slot = slots(p, n)
    half = p // 2
    return [(min((j + slot // 2) // slot, half - 1) + shift) % half for j in range(n)]


def testpoly(p: int, n: int, shift: int) -> tuple:
    """Line 5 (part 2) — the coefficients sampled at the four slot boundaries."""
    slot = slots(p, n)
    v = testvector(p, n, shift)
    return tuple(v[min(j * slot, n - 1)] for j in range(4))


def rescale_one(q: int, n: int, x: int) -> int:
    """Line 6 (part 1) — one value carried from the q world onto the ring's 2n positions."""
    return round(x * 2 * n / q)


def rescale(p: int, q: int, n: int, a, b: int) -> tuple:
    """Line 6 (part 2) — (D̂, â[0], b̂): the scaling step and the ciphertext, rescaled."""
    return (rescale_one(q, n, q // p), rescale_one(q, n, a[0]), rescale_one(q, n, b))


def index(q: int, n: int, s, a, b: int) -> int:
    """Line 7 — the rotation amount: b̂ minus the rescaled â.s, reduced mod 2n (never n)."""
    shifted = sum(rescale_one(q, n, x) * y for x, y in zip(a, s))
    return (rescale_one(q, n, b) - shifted) % (2 * n)


def constant_at(v: list, i: int) -> int:
    """Line 8 (part 1) — the constant term of x^(-i) * v(x) mod x^n + 1."""
    n = len(v)
    wrapped = i % (2 * n)
    if wrapped < n:
        return v[wrapped]
    return -v[wrapped - n]


def readout(p: int, q: int, n: int, s, a, b: int, shift: int) -> int:
    """Line 8 (part 2) — rotate the test polynomial by the index, read address zero."""
    return constant_at(testvector(p, n, shift), index(q, n, s, a, b))


def programmable(p: int, q: int, s, a, b: int, shift: int) -> int:
    """Line 9 — f(m) computed directly: what the readout must equal."""
    return (split(p, q, s, a, b)[0] + shift) % (p // 2)


def window(p: int, q: int, n: int, s, a, b: int, shift: int) -> int:
    """Line 10 — how many positions around the index return the same value."""
    v = testvector(p, n, shift)
    idx = index(q, n, s, a, b)
    slot = slots(p, n)
    middle = constant_at(v, idx)
    return sum(1 for d in range(-slot, slot + 1) if constant_at(v, idx + d) == middle)


def edge(p: int, q: int, n: int, s, a, b: int, shift: int) -> int:
    """Line 11 — how many more positions the noise may push before the readout changes."""
    v = testvector(p, n, shift)
    idx = index(q, n, s, a, b)
    here = constant_at(v, idx)
    return next(d for d in range(1, 2 * n + 1) if constant_at(v, idx + d) != here) - 1


def sweep(p: int, q: int, n: int, s, a, b: int, shift: int) -> bool:
    """Line 12 — every usable plaintext through the same machine: readout == f(m) for all."""
    v = testvector(p, n, shift)
    delta = q // p
    half = p // 2
    inner = sum(x * y for x, y in zip(a, s)) % q
    shifted = sum(rescale_one(q, n, x) * y for x, y in zip(a, s))
    noise = split(p, q, s, a, b)[1]
    return all(
        constant_at(v, (rescale_one(q, n, (inner + delta * t + noise) % q) - shifted) % (2 * n))
        == (t + shift) % half
        for t in range(half)
    )
