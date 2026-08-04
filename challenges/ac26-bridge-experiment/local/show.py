"""`make inspect` — show the worked example and the corrupted trace.

Everything here is derived from FLAG_SEED, so what you see is yours: copying
another learner's numbers will not help you.

The command is called `inspect`; none of the checkpoints are. It only shows
evidence, and it never produces an answer.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import corrupted_trace, health_token, public_case, walkback_case

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    case = public_case(SEED)
    print("== checkpoint: environment ==")
    print(f"python           {sys.version.split()[0]}")
    print(f"health token     {health_token(SEED)}")
    print()
    print("== checkpoint: predict ==")
    print("Work this out on paper BEFORE running your code:")
    print(f"  start={case.start} step={case.step} rounds={case.rounds} modulus={case.modulus}")
    print("  submit the value after the last round. One integer, not the whole trace.")
    print()
    print("== why this counter is not cryptography yet (nothing to submit) ==")
    walk = walkback_case(SEED)
    print("  A second walk, this one shown in full:")
    print(f"    start={walk['start']} step={walk['step']} "
          f"rounds={walk['rounds']} modulus={walk['modulus']}, ending on {walk['final']}.")
    print(f"    Reducing mod {walk['modulus']} keeps every value inside "
          f"0..{walk['modulus'] - 1}, so the size of")
    print("    the answer tells you nothing about how far it walked. The number of")
    print("    steps is still recoverable, though:")
    print(f"      {walk['undoStep']} is what takes {walk['step']} back to 1 "
          f"({walk['step']} * {walk['undoStep']} = 1 mod {walk['modulus']}), so")
    print(f"      ({walk['final']} - {walk['start']}) * {walk['undoStep']} "
          f"mod {walk['modulus']} = {walk['recoveredRounds']} -- the step count, back again.")
    print("    Week 3 keeps this walk and changes what is walked on, to something where")
    print("    that last line has no practical answer. Signatures stand on that gap.")
    print()
    print("== checkpoint: first-broken ==")
    bad_case, trace, _broke_at = corrupted_trace(SEED)
    print(f"  start={bad_case.start} step={bad_case.step} "
          f"rounds={bad_case.rounds} modulus={bad_case.modulus}")
    print("  this trace was produced by an implementation that skipped the reduction")
    print("  on exactly one round. Submit the 0-based index of the FIRST entry that")
    print(f"  breaks the invariant 0 <= value < {bad_case.modulus}.")
    print(f"  trace = {trace}")


if __name__ == "__main__":
    main()
