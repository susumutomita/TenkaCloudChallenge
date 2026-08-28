"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from "Inspect evidence". If you cannot open Python, fill in these functions in the
Portal editor instead and press "Run public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. p is the
plaintext modulus, n the ring degree (so q = 2n and D = q/p), v the all-ones test
polynomial, lo and hi the two probe exponents, noise_a and noise_b the two input
ciphertexts' noise, dmax the largest noise either may carry.
"""

from __future__ import annotations


def params(p: int, n: int) -> tuple:
    """Line 1 — (p, q, n, D): the ring's four constants, q = 2n and D = q/p."""
    return (p, 2 * n, n, (2 * n) // p)


def wrap(lo: int, hi: int, n: int) -> tuple:
    """Line 2 — x^(lo+hi) mod x^n + 1 as (reduced exponent, sign, exponent before)."""
    total = lo + hi
    return (total % n, 1 if (total // n) % 2 == 0 else -1, total)


def constant_at(v: list, i: int) -> int:
    """Line 3 (part 1) — the constant term of x^(-i) * v(x) mod x^n + 1."""
    n = len(v)
    wrapped = i % (2 * n)
    if wrapped < n:
        return v[wrapped]
    return -v[wrapped - n]


def signs(v: list, probes) -> tuple:
    """Line 3 (part 2) — the constant term at each of the six probe indices."""
    return tuple(constant_at(v, i) for i in probes)


def boundary(v: list) -> int:
    """Line 4 — the smallest i whose constant term comes out negated."""
    n = len(v)
    return min(i for i in range(2 * n) if constant_at(v, i) < 0)


def hazard(v: list, lo: int) -> tuple:
    """Line 5 — the read that overshoots by n: (lo + n, the constant term there)."""
    n = len(v)
    return (lo + n, constant_at(v, lo + n))


def encoding(p: int) -> tuple:
    """Line 6 — the bit encoding (bit 0, bit 1) = (p - 1, 1)."""
    return (p - 1, 1)


def phases(p: int) -> tuple:
    """Line 7 — r = 1 - m1 - m2 mod p for the four input pairs (0,0), (0,1), (1,0), (1,1)."""
    enc = encoding(p)
    table = {0: enc[0], 1: enc[1]}
    return tuple((1 - table[a] - table[b]) % p for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)))


def rotations(p: int, n: int, noise_a: int, noise_b: int) -> tuple:
    """Line 8 — the four rotation amounts D*r - (noise_a + noise_b) mod q."""
    q = 2 * n
    delta = q // p
    total = noise_a + noise_b
    return tuple((delta * ph - total) % q for ph in phases(p))


def constants(p: int, n: int, noise_a: int, noise_b: int) -> tuple:
    """Line 9 — the constant term after each of the four rotations."""
    v = [1] * n
    return tuple(constant_at(v, rot) for rot in rotations(p, n, noise_a, noise_b))


def nand_table() -> tuple:
    """Line 10 — the NAND truth table for the four input pairs."""
    return tuple(1 - (a & b) for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)))


def noise_sweep(p: int, n: int, dmax: int) -> bool:
    """Line 11 — does the table close for EVERY noise total 0..dmax, not just this one."""
    q = 2 * n
    delta = q // p
    v = [1] * n
    want = nand_table()
    return all(
        constant_at(v, (delta * ph - d) % q) == (1 if bit else -1)
        for ph, bit in zip(phases(p), want)
        for d in range(dmax + 1)
    )


def margin(p: int, n: int) -> int:
    """Line 12 — the room between the largest rotation 3D and the boundary n."""
    delta = (2 * n) // p
    return n - 3 * delta
