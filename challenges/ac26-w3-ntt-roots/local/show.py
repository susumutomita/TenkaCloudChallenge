"""`make inspect` — your moduli, and a worked extended-Euclid trace.

    make inspect              your fixtures and a trace for a default value
    make inspect A=17 P=101   the trace for any pair you like

The trace is here to make the algorithm legible. It is emphatically not a
constant-time implementation: it branches on the values and its running time depends
on them, which is fine for learning arithmetic and disqualifying for handling a real
secret key.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    composite_modulus,
    egcd,
    egcd_rows,
    health_token,
    non_invertible,
    prime_modulus,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main(argv: list[str]) -> None:
    p = prime_modulus(SEED)
    n = composite_modulus(SEED)
    a = int(os.environ.get("A") or (argv[0] if argv else 0)) or (p // 3 + 1)
    modulus = int(os.environ.get("P") or (argv[1] if len(argv) > 1 else 0)) or p

    print("health token     :", health_token(SEED))
    print("prime modulus    :", p)
    print("composite modulus:", n, f"(smallest non-invertible element: {non_invertible(SEED, n)})")
    print()
    print(f"extended Euclid for a = {a}, modulus = {modulus}")
    print(f"  normalized a   : {a % modulus}")
    print("   step |     q |     r |     s |     t")
    for index, row in enumerate(egcd_rows(a % modulus, modulus)):
        print(f"   {index:4d} | {row['q']:5d} | {row['r']:5d} | {row['s']:5d} | {row['t']:5d}")
    g, s, _t = egcd(a % modulus, modulus)
    print(f"  gcd            : {g}")
    if g == 1:
        candidate = s % modulus
        print(f"  inverse         : {candidate}")
        print(f"  verification    : {a % modulus} * {candidate} mod {modulus}"
              f" = {(a * candidate) % modulus}")
    else:
        print(f"  no inverse      : gcd is {g}, not 1")
    print()
    print("This trace branches on its inputs and its running time depends on them.")
    print("It is for reading the algorithm, not for handling a real key.")


if __name__ == "__main__":
    main(sys.argv[1:])
