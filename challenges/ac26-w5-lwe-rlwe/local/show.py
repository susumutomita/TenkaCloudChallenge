"""`make inspect` — the ring, one LWE sample, one RLWE sample, and where they line up.

Everything is derived from FLAG_SEED, so what you see is yours.

The secret is not printed. Its shape is, because you need that to read the trace, but the
values are only shown under `make inspect SECRET=1` — this is a toy and the secret is short
enough to search, so hiding it is a reading discipline rather than a security boundary. Read
the trace once without it and you will notice which quantities the phase actually depends on.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    centered,
    cyclic_mul,
    decode,
    encode,
    health_token,
    lwe_case,
    lwe_encrypt,
    lwe_phase,
    noise_interval,
    normalize,
    params,
    phase_coefficient_terms,
    ring_mul,
    rlwe_case,
    rlwe_encrypt,
    rlwe_phase,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
SHOW_SECRET = os.environ.get("SHOW_SECRET", "") not in ("", "0", "false")


def _poly(coefficients) -> str:
    return "[" + " ".join(f"{value:>3}" for value in coefficients) + "]"


def _secret(values) -> str:
    if SHOW_SECRET:
        return _poly(values)
    return f"<{len(values)} coefficients in {{-1, 0, 1}}, hidden — `make inspect SECRET=1`>"


def _recovered(par: dict, phase: int) -> int:
    """The noise, read back out of the phase: how far it sits from its nearest point."""
    return centered(par, phase - encode(par, decode(par, phase)))


def main() -> None:
    par = params(SEED)
    n, dim, q, p, delta = (
        par["degree"],
        par["dimension"],
        par["q"],
        par["p"],
        par["delta"],
    )
    low, high = noise_interval(par)

    print("health token :", health_token(SEED))
    print()
    print("  the ring          R_q = Z_q[X] / (X^N + 1)")
    print(f"  N (degree)        {n}")
    same = "  <- equal to N under THIS seed only; they are drawn separately"
    print(f"  n (LWE dimension) {dim}{same if dim == n else '    <- not N. They are different numbers.'}")
    print(f"  p (messages)      {p}")
    print(f"  delta (scaling)   {delta}   ({'even' if delta % 2 == 0 else 'odd'})")
    print(f"  q = p * delta     {q}")
    print(f"  noise budget      {low} .. {high}   per coefficient")
    print()

    print("  X^N = -1, so a coefficient walking off the top comes back negated,")
    print("  and one walking off twice comes back as it started:")
    for degree in (n - 1, n, n + 1, 2 * n, 2 * n + 1):
        unit = [0] * degree + [1]
        print(f"    X^{degree:<3} = {_poly(normalize(par, unit))}")
    print()

    # The two rules agree on a great many inputs. This is one where they do not.
    left = [0] * (n - 1) + [1]
    right = [0, 1] + [0] * (n - 2)
    print("  the two multiplication rules, on X^(N-1) * X:")
    print(f"    negacyclic  {_poly(ring_mul(par, left, right))}   <- X^N = -1")
    print(f"    cyclic      {_poly(cyclic_mul(par, left, right))}   <- X^N = +1, a different ring")
    print("  Everything below is built on the first one.")
    print()

    lwe = lwe_case(par, SEED, "inspect", 0)
    inner = sum(a * s for a, s in zip(lwe["mask"], lwe["secret"])) % q
    ciphertext = lwe_encrypt(par, lwe["secret"], lwe["message"], lwe["mask"], lwe["error"])
    phase = lwe_phase(par, lwe["secret"], ciphertext)
    print("  LWE")
    print(f"    secret s        {_secret(lwe['secret'])}")
    print(f"    mask a          {_poly(lwe['mask'])}")
    print(f"    <a, s>          {inner}")
    print(f"    message m       {lwe['message']}")
    print(f"    encode(m)       {encode(par, lwe['message'])}")
    print(f"    noise e         {lwe['error']}")
    print(f"    body b          {ciphertext[1]}    = <a, s> + encode(m) + e")
    print(f"    phase b-<a,s>   {phase}")
    print(f"    centered        {centered(par, phase)}    the centered representative")
    print(f"    decode(phase)   {decode(par, phase)}")
    print(
        f"    noise recovered {_recovered(par, phase)}    "
        "= centered(phase - encode(decode(phase))), and it is e again"
    )
    print()

    rlwe = rlwe_case(par, SEED, "inspect", 0)
    product = ring_mul(par, rlwe["mask"], rlwe["secret"])
    rciphertext = rlwe_encrypt(
        par, rlwe["secret"], rlwe["message"], rlwe["mask"], rlwe["error"]
    )
    rphase = rlwe_phase(par, rlwe["secret"], rciphertext)
    print("  RLWE — every scalar above is a polynomial here")
    print(f"    secret s        {_secret(rlwe['secret'])}")
    print(f"    mask a          {_poly(rlwe['mask'])}")
    print(f"    a * s           {_poly(product)}")
    print(f"    message m       {_poly(rlwe['message'])}")
    print(f"    encode(m)       {_poly([encode(par, m) for m in rlwe['message']])}")
    print(f"    noise e         {_poly(rlwe['error'])}")
    print(f"    body b          {_poly(rciphertext[1])}")
    print(f"    phase b-a*s     {_poly(rphase)}")
    print(f"    centered        {_poly([centered(par, c) for c in rphase])}")
    print(f"    decode(phase)   {_poly([decode(par, c) for c in rphase])}")
    print(f"    noise recovered {_poly([_recovered(par, c) for c in rphase])}    = e again")
    print()

    print("  the same trace, coefficient by coefficient, next to the LWE one:")
    print("    k    a*s[k]   encode   noise   b[k]    phase   decoded   recovered")
    for k in range(n):
        print(
            f"    {k:<4} {product[k]:<8} {encode(par, rlwe['message'][k]):<8} "
            f"{rlwe['error'][k]:<7} {rciphertext[1][k]:<7} {rphase[k]:<7} "
            f"{decode(par, rphase[k]):<9} {_recovered(par, rphase[k])}"
        )
    print("  Each row is one message spending its own budget. The LWE block above is one row.")
    print()

    print("  and each row is an inner product against the same secret:")
    for k in range(min(n, 3)):
        terms = phase_coefficient_terms(par, rlwe["mask"], k)
        print(f"    k={k}  v = {_poly(terms)}   <v, s> = {product[k]}")
    print("  Compare v with the mask. Some entries moved; some entries also changed sign.")
    print("  Which ones, and why those, is the correspondence this problem grades.")
    print()

    print("None of this is secure. q is small enough to enumerate and the secret is short")
    print("enough to search, which is the only reason these values are printable at all.")


if __name__ == "__main__":
    main()
