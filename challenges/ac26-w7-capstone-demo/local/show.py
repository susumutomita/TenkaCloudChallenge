"""`make inspect` — the setting you build for, and the two worlds privacy is measured across.

Everything here is derived from FLAG_SEED, so what you see is yours. The hidden tests use
more parties and other fields, and they enumerate the whole probability space of the tiny
setting rather than sampling it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    CLAIMABLE,
    NOT_PROVIDED,
    PROVIDED,
    honest_sum,
    public_setting,
    randomness_space,
    sample_randomness,
    tiny_settings,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    setting = public_setting(SEED)
    print("== your setting ==")
    print(f"  parties            {setting.parties}")
    print(f"  field              F_{setting.modulus}")
    print(f"  inputs             {list(setting.inputs)}")
    print(f"  the sum they want  {honest_sum(setting)}")
    print()
    print("  randomness contract")
    print(f"    length           {setting.randomness_length}  (parties x (parties - 1))")
    for party in range(setting.parties):
        low, high = setting.slice_for(party)
        print(f"    party {party} draws   randomness[{low}:{high}]")
    print(f"  one sample         {list(sample_randomness(SEED, setting))}")
    print()

    print("== the vocabulary ==")
    print(f"  claimable          {', '.join(CLAIMABLE)}")
    print(f"  this build gives   {', '.join(sorted(PROVIDED))}")
    print(f"  and does not give  {', '.join(sorted(NOT_PROVIDED))}")
    print("  Work out for yourself why the second pair is missing before you write `scope`.")
    print()

    left, right = tiny_settings()
    space = len(list(randomness_space(left)))
    print("== how privacy is measured ==")
    print("  Two settings, the same sum, different honest inputs:")
    print(f"    A  inputs={list(left.inputs)}   sum={honest_sum(left)}  over F_{left.modulus}")
    print(f"    B  inputs={list(right.inputs)}   sum={honest_sum(right)}  over F_{right.modulus}")
    print()
    print(f"  Every randomness is enumerated: {space} of them, per setting, per coalition.")
    print("  That is the entire probability space, not a sample. If a coalition below the")
    print("  threshold sees a different distribution in A than in B, it has learned")
    print("  something the output alone does not tell it.")
    print()
    print("  Sweep every coalition. A protocol can be perfectly private against party 0")
    print("  and hand party 2 everything -- and a check that only ever asks party 0 will")
    print("  report that protocol as private.")


if __name__ == "__main__":
    main()
