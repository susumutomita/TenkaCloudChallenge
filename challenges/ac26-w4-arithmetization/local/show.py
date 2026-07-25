"""`make inspect` — the machine, its trace, and the domain the trace maps onto."""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import domain, health_token, honest_trace, setting

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    cfg = setting(SEED)
    trace = honest_trace(cfg)
    points = domain(cfg)

    print("health token :", health_token(SEED))
    print(f"field        : F_{cfg['p']}")
    print(f"steps        : {cfg['steps']}")
    print(f"weight       : {cfg['weight']}")
    print(f"start        : a0 = {cfg['start'][0]}, b0 = {cfg['start'][1]}")
    print()
    print("  a_{i+1} = a_i + b_i")
    print(f"  b_{{i+1}} = b_i + {cfg['weight']}*a_i        (mod {cfg['p']})")
    print()
    print("  row   a     b     domain point")
    for index, (a, b) in enumerate(trace):
        print(f"  {index:<5} {a:<5} {b:<5} {points[index]}")
    print()
    print(f"The domain is the {cfg['steps']} powers of a root of unity, in trace order.")
    print(f"Row i sits at point {points[1]}^i, so consecutive rows are consecutive points")
    print("and the transition constraint becomes a relation between a polynomial at x")
    print("and the same polynomial at the next point.")
    print()
    print("There are two kinds of constraint here and they do different jobs.")
    print("Count how many transition residuals this trace has before you write them.")


if __name__ == "__main__":
    main()
