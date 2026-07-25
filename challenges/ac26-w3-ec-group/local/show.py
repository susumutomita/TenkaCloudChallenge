"""`make inspect` — your curve, its points, and a double-and-add trace.

    make inspect          your fixture's curve and a default scalar
    make inspect K=13     the trace for any scalar

The trace branches on the scalar's bits and its work depends on them. That is the
opposite of what a constant-time implementation does, and it is why real libraries do
not multiply this way. It is here so the algorithm is legible.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import curve_params, health_token, order_two_points, points_on

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    p, a, b = curve_params(SEED)
    every = points_on(p, a, b)
    scalar = int(os.environ.get("K") or 0) or 13

    print("health token :", health_token(SEED))
    print(f"curve        : y^2 = x^3 + {a}x + {b}  (mod {p})")
    print(f"affine points: {len(every)}  (plus the identity, so the group has {len(every) + 1})")
    print("vertical tangent at:", order_two_points(p, a, b) or "nowhere")
    print()
    print("the first few points:")
    for coords in every[:8]:
        print(f"  {coords}")
    if (0, 0) in every:
        print()
        print("  Note (0, 0) in that list. It is an ordinary point of order two on this")
        print("  curve, which is why the identity cannot be represented by it.")
    print()
    bits = [(scalar >> index) & 1 for index in range(max(scalar.bit_length(), 1))]
    print(f"double-and-add for k = {scalar}:")
    print(f"  {scalar} = 0b{scalar:b}, so there are {len(bits)} steps")
    print(f"  bits, least significant first: {bits}")
    print()
    print("  your trace returns one row per step, each shaped:")
    print("    {'index', 'bit', 'accumulator_before', 'addend_before',")
    print("     'added', 'accumulator_after', 'addend_after', 'on_curve'}")
    print("  with points rendered as 'O' for the identity and '(x, y)' otherwise.")
    print()
    print("The values are not printed here -- producing them is the checkpoint. Run")
    print("`make inspect K=<n>` to see the step count and bits for another scalar.")


if __name__ == "__main__":
    main()
