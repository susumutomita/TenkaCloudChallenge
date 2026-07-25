"""`make inspect` — the ring, the encoding points, and where a message stops surviving.

Everything is derived from FLAG_SEED, so what you see is yours. The number line is the
supporting view; the table under it is the one to reason from.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    INVALID_PARAMS,
    centered,
    decode,
    encode,
    health_token,
    params,
    success_interval,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WIDTH = 60


def _line(par: dict) -> str:
    """A row of the ring, with an X at each encoding point."""
    q = par["q"]
    cells = ["."] * min(q, WIDTH)
    for m in range(par["p"]):
        position = encode(par, m) * len(cells) // q
        cells[position] = "X"
    return "".join(cells)


def main() -> None:
    par = params(SEED)
    p, delta, q = par["p"], par["delta"], par["q"]
    low, high = success_interval(par)

    print("health token :", health_token(SEED))
    print()
    print(f"  p (messages)      {p}")
    print(f"  delta (scaling)   {delta}   ({'even' if delta % 2 == 0 else 'odd'})")
    print(f"  q = p * delta     {q}")
    print()
    print(f"  ring [0, {q}), one cell per {max(1, q // WIDTH)}:")
    print(f"  {_line(par)}")
    print("  X = an encoding point. The gaps between them are all the room there is.")
    print()

    print("  m     encode(m)   centered      decodes back to")
    for m in range(p):
        point = encode(par, m)
        print(f"  {m:<5} {point:<11} {centered(par, point):<13} {decode(par, point)}")
    print()

    print(f"  tolerated noise: {low} .. {high}   (width {high - low + 1}, and delta is {delta})")
    if low != -high:
        print("  Note that it is not symmetric. Work out which end lost a point, and to what.")
    print()

    # One message walked across its upper boundary, so the flip is visible rather than
    # asserted. Which message is seed-derived; the two at the ends of the space behave
    # differently from the rest and finding that out is part of the problem.
    subject = sum(SEED.encode()) % p
    print(f"  message {subject}, walked across the upper boundary:")
    print("    noise   value    decodes to")
    for noise in range(high - 2, high + 4):
        value = (encode(par, subject) + noise) % q
        marker = "  <- still right" if decode(par, value) == subject else "  <- wrong now"
        print(f"    {noise:<7} {value:<8} {decode(par, value)}{marker}")
    print()

    print("  parameter sets that must be rejected:")
    for reason, invalid in INVALID_PARAMS:
        print(f"    p={invalid['p']:<4} delta={invalid['delta']:<5} q={invalid['q']:<5} {reason}")
    print()
    print("None of this is secure. p and q are small enough to enumerate by hand, which is")
    print("the only reason the boundary is visible at all.")


if __name__ == "__main__":
    main()
