"""`make inspect` — show your fixtures and the two quizzes.

Everything here is derived from FLAG_SEED, so what you see is yours: copying another
learner's numbers will not help you, and the quiz ORDER is yours too, so an answer string
from someone else's deployment is wrong even if their reasoning was right.

What this deliberately does not print: any state after a round, any digest, and the
avalanche distance. Those are the answers.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    avalanche_case,
    health_token,
    inversion_case,
    property_quiz,
    round_case,
    storage_quiz,
)
from given.primitives import INITIAL_STATE, K

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

STATE_NAMES = "abcdefgh"


def _state(label: str, state: tuple[int, ...]) -> None:
    print(f"  {label}")
    for name, word in zip(STATE_NAMES, state):
        print(f"    {name}  {word:08x}")


def main() -> None:
    print(f"python        {sys.version.split()[0]}")
    print(f"health token  {health_token(SEED)}")
    print()

    print("== given to you, already correct ==")
    print("  local/given/primitives.py has padding, big-endian words, the four sigmas,")
    print("  Ch, Maj and the message schedule. Do not edit it. Its constant tables are")
    print("  derived from prime roots rather than pasted, so you can see where they")
    print("  come from:")
    print(f"    K[0]   {K[0]:08x}   fractional bits of the cube root of 2")
    print(f"    K[63]  {K[63]:08x}   cube root of the 64th prime")
    print(f"    H[0]   {INITIAL_STATE[0]:08x}   square root of 2")
    print()

    case = round_case(SEED)
    print("== checkpoint: round ==")
    _state("input state:", case.state)
    print(f"    round index   {case.round_index}")
    print(f"    K[{case.round_index}]           {K[case.round_index]:08x}")
    print(f"    schedule word {case.schedule_word:08x}")
    print("  Implement `round_step`. Only two of the eight words are computed.")
    print()

    state, schedule = inversion_case(SEED)
    print("== checkpoint: feedforward ==")
    _state("a state to run forwards and then backwards:", state)
    print(f"    schedule[0]  {schedule[0]:08x}    schedule[63] {schedule[63]:08x}")
    print("  Implement `invert_round` and `invert_rounds`. The 64 rounds throw nothing")
    print("  away, so they can be undone. Then look at what the feed-forward addition")
    print("  in `compress_block` does to that.")
    print()

    avalanche = avalanche_case(SEED)
    print("== checkpoint: avalanche ==")
    print(f"  message  {avalanche.message.hex()}")
    print(f"  flip bit {avalanche.bit} of it (bit 0 is the least significant bit of byte 0):")
    print(f"           {avalanche.flipped.hex()}")
    print("  Hash both. Submit how many of the 256 digest bits differ.")
    print()

    print("== checkpoint: properties ==")
    print("  True or false, in this order. Submit one letter each, e.g. TFTF...")
    for index, statement in enumerate(property_quiz(SEED), start=1):
        print(f"  {index:>2}. {statement.text}")
        print(f"      {statement.text_ja}")
    print()

    print("== checkpoint: storage ==")
    print("  You are storing user passwords. True or false, in this order.")
    for index, statement in enumerate(storage_quiz(SEED), start=1):
        print(f"  {index:>2}. {statement.text}")
        print(f"      {statement.text_ja}")
    print()

    print("== checkpoints: compress / digest ==")
    print("  No fixture to read. `make test` runs the public tests against your")
    print("  `local/starter/compress.py`; each checkpoint runs a wider hidden set.")
    print("  compress -> compress_rounds, compress_block")
    print("  digest   -> sha256_hex")


if __name__ == "__main__":
    main()
