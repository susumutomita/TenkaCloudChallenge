"""`make inspect` — show your fixtures, in hex and in bits.

Everything here is derived from FLAG_SEED, so what you see is yours: copying another
learner's numbers will not help you.

The bit rows exist because these checkpoints are about bit positions, and reading a
rotation out of two hex strings is much harder than reading it out of two bit rows.
What this deliberately does not print is any expanded schedule, or the result of any
sigma: those are the answers.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    WORD_BITS,
    WORDS_PER_BLOCK,
    dependency_case,
    health_token,
    mux_case,
    rotate_case,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _bits(word: int) -> str:
    """32 bits, grouped in fours, so a position can be counted rather than guessed."""
    raw = f"{word:032b}"
    return " ".join(raw[offset : offset + 4] for offset in range(0, WORD_BITS, 4))


def _row(label: str, word: int) -> str:
    return f"  {label:<10} {word:08x}   {_bits(word)}"


def main() -> None:
    print(f"python        {sys.version.split()[0]}")
    print(f"health token  {health_token(SEED)}")
    print()

    rotate = rotate_case(SEED)
    print("== checkpoint: rotate ==")
    print(_row("word", rotate.word))
    print(f"  Rotate it right by {rotate.rotate_by}, then shift it right by {rotate.shift_by}.")
    print("  Submit both results as 8 hex characters each, rotation first, comma separated.")
    print("  A rotation keeps every bit. A shift does not. Count the set bits if unsure.")
    print()

    mux = mux_case(SEED)
    print("== checkpoint: mux ==")
    print(_row("e (select)", mux.e))
    print(_row("f", mux.f))
    print(_row("g", mux.g))
    print("  Submit Ch(e, f, g) as 8 hex characters.")
    print("  f and g are exact complements here, so every bit position is decided by e.")
    print()

    dependency = dependency_case(SEED)
    print("== checkpoint: dependency ==")
    print(f"  These are W[0] through W[{WORDS_PER_BLOCK - 1}] of one block:")
    for index, word in enumerate(dependency.words):
        print(_row(f"W[{index}]", word))
    print(f"  Flip bit {dependency.bit} of W[{dependency.index}] (bit 0 is the least significant).")
    print("  Submit the index of the FIRST word in the 64-word schedule that changes.")
    print("  You can work this out from the recurrence without expanding anything.")
    print()

    print("== checkpoints: sigma / logic / schedule ==")
    print("  No fixture to read. `make test` runs the public tests against your")
    print("  `local/starter/schedule.py`; each checkpoint runs a wider hidden set.")
    print("  sigma    -> rotr, small_sigma0, small_sigma1, big_sigma0, big_sigma1")
    print("  logic    -> choose, majority")
    print("  schedule -> expand_schedule")


if __name__ == "__main__":
    main()
