"""`make inspect` — show the worked example and the list with one number out of place.

Everything here is derived from FLAG_SEED, so what you see is yours: copying
another learner's numbers will not help you.

The command is called `inspect`; none of the boxes you fill in are. It only shows
evidence, and it never produces an answer.

Written for someone who has arithmetic and nothing else: no "modulus", no
"invariant", no "trace", no "index" without the thing itself on screen next to it.
The names `start` / `step` / `rounds` / `modulus` appear once, as a bridge to
counter.py, after the four numbers have already been explained in words.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_evidence() -> dict[str, object]:
    """This deployment's public evidence.

    Issue 543/537: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile) -- keeping its seed-keyed generator
    reachable here, even with `first-broken`'s own answer moved out to
    `verifier/expected.py`, still handed a learner the broken index for the price of
    one extra line over what `corrupted_trace` already gave them. `make inspect` now
    runs through Compose (see the Makefile) so this process can reach the verifier,
    which is the only place `fixtures/` still lives, over the network instead.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Resolves only against a checkout with fixtures/ still on disk (never true inside
    # a built participant image -- see the docstring above).
    from fixtures.generate import public_payload

    return public_payload(SEED)


def numbered_list(values: list[int]) -> tuple[str, str]:
    """The list, and a row of positions that sits directly under it.

    "0-based index" is never explained in this problem; the positions are printed
    under the numbers instead, which is the same fact and needs no words. Both rows
    are pure ASCII, so they line up in whatever font the reader has.
    """
    parts = [str(value) for value in values]
    listing = "[" + ", ".join(parts) + "]"
    positions = ""
    column = 1  # the "[" is one character wide
    for index, part in enumerate(parts):
        positions += " " * (column - len(positions)) + str(index)
        column += len(part) + 2  # the number itself, then ", "
    return listing, positions


def add_once(value: int, step: int, modulus: int) -> str:
    """One addition, written the way a reader would do it on paper."""
    raw = value + step
    # 14 clears the widest sum this problem can print ("22 + 22 = 44"), so the
    # explanation never runs straight into the arithmetic.
    sum_text = f"{value} + {step} = {raw}"
    if raw >= modulus:
        return f"{sum_text:<14}{raw} reaches {modulus}, so {raw} - {modulus} = {raw - modulus}"
    return f"{sum_text:<14}{raw} is below {modulus}, so leave it"


def main() -> None:
    evidence = _public_evidence()
    case = evidence["predict"]
    print("== what goes in the environment box ==")
    print(f"  python       {evidence['environment']['python']}")
    print(f"  pass phrase  {evidence['environment']['healthToken']}")
    print("  Paste that phrase into the environment box in the Portal, exactly as printed.")
    print("  It is only proof that this container really ran.")
    print()

    modulus = case["modulus"]
    print("== what goes in the predict box ==")
    print(f"  Only the numbers 0 to {modulus - 1} are used here. Like a clock, where three hours after")
    print(f"  10 o'clock is 1 o'clock and not 13: as soon as a number reaches {modulus}, take {modulus} off")
    print(f"  it. (That is the same thing as the remainder after dividing by {modulus}.)")
    print()
    width = len(str(max(case["start"], case["step"], case["rounds"], modulus)))
    print(f"    {case['start']:>{width}}  is where you start")
    print(f"    {case['step']:>{width}}  gets added each time")
    print(f"    {case['rounds']:>{width}}  times in total")
    print(f"    {modulus:>{width}}  gets taken off whenever a number reaches it")
    print("    (counter.py calls those four start / step / rounds / modulus)")
    print()
    print("  The first two additions, done for you:")
    first = (case["start"] + case["step"]) % modulus
    print(f"    {add_once(case['start'], case['step'], modulus)}")
    print(f"    {add_once(first, case['step'], modulus)}")
    if case["start"] + case["step"] < modulus and first + case["step"] < modulus:
        print(f"    (one that does reach {modulus}: {modulus - 1} + {case['step']} = "
              f"{modulus - 1 + case['step']}, so {modulus - 1 + case['step']} - {modulus} = {case['step'] - 1})")
    print()
    print(f"  Carry on the same way to the end. The number you are on after the {case['rounds']}th addition")
    print("  is what goes in the predict box: one number, not the list of all of them. Work")
    print("  it out on paper before you run anything -- that is the whole point of this box.")
    print()

    walk = evidence["walkback"]
    print("== what goes in the walkback box ==")
    print(f"  A second run, shown with its end but not its length: start at {walk['start']}, add {walk['step']} each")
    print(f"  time, take {walk['modulus']} off whenever a number reaches it. It finishes on {walk['final']}.")
    print(f"  Looking at {walk['final']} alone tells you nothing about how many times {walk['step']} was added --")
    print(f"  every answer is one of 0 to {walk['modulus'] - 1}, so the size of it gives nothing away.")
    print("  The number of times comes back out anyway. The statement gives the recipe: find the")
    print(f"  number that undoes {walk['step']} (multiply, take {walk['modulus']} off until the remainder is 1),")
    print(f"  then multiply it by how far {walk['start']} moved to reach {walk['final']}. That count is the")
    print("  walkback box: one number.")
    print()
    print("== what goes in the no-walkback box ==")
    print(f"  Keep {walk['step']} as the number being added and change the ring size. On some sizes no")
    print(f"  number undoes {walk['step']} at all -- the recipe above never reaches a remainder of 1.")
    print("  One such ring size, bigger than the step and at most 100, is the no-walkback box.")
    print("  That gap is why Week 3 changes what gets added -- to a thing called an elliptic")
    print("  curve -- so that the walk-back has no practical answer on purpose.")
    print()

    bad_case = evidence["firstBroken"]
    trace = bad_case["trace"]
    listing, positions = numbered_list(trace)
    print("== what goes in the first-broken box ==")
    print("  Someone else played the same game and wrote down every number they got:")
    print(f"  start at {bad_case['start']}, add {bad_case['step']} each time, take {bad_case['modulus']} off "
          f"whenever a number reaches it, {bad_case['rounds']} times.")
    print(f"  On one of those {bad_case['rounds']} additions they forgot to take the {bad_case['modulus']} off. "
          f"So exactly one")
    print(f"  number in the list below is not between 0 and {bad_case['modulus'] - 1}.")
    print()
    print(f"    {listing}")
    print(f"    {positions}    <- positions, counting 0, 1, 2 ... from the left")
    print()
    print(f"  Which position is the number that is not between 0 and {bad_case['modulus'] - 1}?")
    print("  Write that one number (the leftmost is 0) in the first-broken box.")


if __name__ == "__main__":
    main()
