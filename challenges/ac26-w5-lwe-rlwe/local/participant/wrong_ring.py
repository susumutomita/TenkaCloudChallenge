"""The WRONG product, written out, so the counterexample is against a stated weakness.

`X^N = +1` instead of `X^N = -1`. Every ring axiom still holds, the product still
distributes and commutes, and most products still agree with the negacyclic one -- which
is exactly why a learner who writes this passes their own round-trip test and notices
nothing. Compare your `ring_mul` against this one on an input that wraps.

Issue 543/537 (option B2): this used to live in `fixtures/generate.py`. That module has
to define working `normalize`, `ring_mul`, `lwe_encrypt` and the rest -- the very names
`starter/lwe.py` asks you to write -- so it does not ship in the participant image any
more (see ../Dockerfile). The wrong product is not an answer to anything, and the problem
statement leans on your being able to read it, so it moved here rather than out of reach.
`fixtures/generate.py` and `tests/hidden/check_lwe.py` import this one definition; there
is no second copy to drift from it.
"""

from __future__ import annotations


def cyclic_mul(par: dict, a, b) -> tuple[int, ...]:
    n, q = par["degree"], par["modulus"]
    left, right = _pad(par, a), _pad(par, b)
    out = [0] * n
    for i, x in enumerate(left):
        for j, y in enumerate(right):
            out[(i + j) % n] = (out[(i + j) % n] + x * y) % q
    return tuple(out)


def _pad(par: dict, coefficients) -> list[int]:
    values = list(coefficients)[: par["degree"]]
    return values + [0] * (par["degree"] - len(values))
