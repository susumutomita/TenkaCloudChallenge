"""The whole participant surface, driven from the container terminal.

The terminal sends one line at a time and has no TTY, so every command here is a
single line with short arguments: no editor, no prompt, no multi-line paste. That
constraint shaped the interface rather than being worked around.

    beaver show
    beaver open 1234,567
    beaver row 890
    beaver product 123
    beaver transfer open=12,34 row=56 product=78
    beaver flag

`beaver` is a wrapper installed on PATH; `python /problem/beaver.py <command>` is
the same thing, and works from any working directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved from this file rather than from the working directory: the portal's
# terminal does not promise to land in /problem, and `python beaver.py` failing with
# an ImportError because of where the shell started would be an unanswerable error
# message.
sys.path.insert(0, str(HERE))

from fixtures.generate import (  # noqa: E402 - after the sys.path line, deliberately
    FAULT,
    LIVE,
    TRANSFER,
    broadcast,
    designated_party,
    field_modulus,
    flag as derive_flag,
    party_count,
    published_total,
    your_index,
    your_rows,
)
from lab import progress  # noqa: E402
from lab.judge import check_open, check_product, check_row, check_transfer  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

USAGE = """beaver lab -- the one operation that has to talk, and how little it has to say

  beaver show
      the multiplication, this deployment's numbers, the five rows you hold, what
      the other parties broadcast, and the exact command for each stage. Start
      here, and run it again whenever you lose your place.

  beaver open <d>,<e>
      the two values the round makes public. Two numbers, each reduced into
      [0, p).

  beaver row <number>
      YOUR row of the product, assembled from the triple's rows and the two opened
      values. One number.

  beaver product <number>
      what the desk should have published, given the number it did publish and the
      fault `beaver show` describes. One number.

  beaver transfer open=<d>,<e> row=<n> product=<n>
      the same three readings on a second multiplication, handed over once the
      three above are cleared. Different field, different party count, and a fault
      that goes the other way.

  beaver status
      what you have cleared so far

  beaver flag
      prints TC{...} once all four stages are cleared. Paste it into the answer box
      on the problem page.

Every command is one line. There is no file to edit and nothing to install.
python3 is in this container if you would rather not do the arithmetic by hand:
`python3 -c "print((1234 * 567) % 4013)"`."""


def _print_case(case: str, heading: str, note: tuple[str, ...] = ()) -> None:
    p = field_modulus(SEED, case)
    n = party_count(SEED, case)
    j = your_index(SEED, case)
    t = designated_party(SEED, case)
    mine = your_rows(SEED, case)

    print(heading)
    for line in note:
        print(f"  {line}")
    print(f"  field p = {p}, parties n = {n}. All arithmetic is modulo p, so every row")
    print(f"  and every opening is an element of [0, {p}).")
    print(f"  -1 and {p - 1} are the same element.")
    print()
    print("== what you hold ==")
    print(f"  you are party {j}.")
    print(f"    your row of X: {mine['x']}")
    print(f"    your row of Y: {mine['y']}")
    print(f"    your row of a: {mine['a']}")
    print(f"    your row of b: {mine['b']}")
    print(f"    your row of c: {mine['c']}")
    print("  X and Y are the two secrets. (a, b, c) is the preprocessed triple, made")
    print("  before anyone knew X or Y, and it satisfies c = a*b. Every one of the five")
    print("  is shared: the rows of each sum to it modulo p, and no party holds any of")
    print("  them in the clear. You will never be shown another party's row of any of")
    print("  them.")
    print()
    print("== the protocol ==")
    print("    d = X - a          each party, on its own two rows")
    print("    e = Y - b          each party, on its own two rows")
    print("    open d, open e     one round: everybody broadcasts both rows, everybody")
    print("                       adds them up")
    print("    X*Y = c + d*b + e*a + d*e")
    print("  the last term is a public scalar once d and e are open, and this desk's")
    print(f"  convention is that party {t} folds it in, and party {t} alone.")
    print()
    print("== what the other parties broadcast ==")
    for index, row in enumerate(broadcast(SEED, case)):
        if index == j:
            print(f"    party {index}:  (yours -- work it out)")
            continue
        print(f"    party {index}:  d row = {row['d']}    e row = {row['e']}")
    print("  a broadcast row is public: that is what opening a value means, and it is")
    print("  the reason the round costs one round and not zero.")
    print()
    print("== what the desk actually published ==")
    print(f"  published product = {published_total(SEED, case)}")
    print(f"  the previous SRE's implementation was faulty: {FAULT[case]}.")
    print("  so that number is the reconstruction of a run that did the wrong thing.")
    print()


def command_show() -> int:
    print("== the one operation that has to talk ==")
    print("  adding two sharings, or scaling one by a value everybody knows, finishes")
    print("  inside each party. Multiplying two SHARED values does not: the sum of the")
    print("  products of the rows is not the product of the sums, and no party holds")
    print("  enough to make up the difference.")
    print()
    print("  So the desk buys its way out in advance. Before anyone knew what would be")
    print("  multiplied, it manufactured a triple (a, b, c) with c = a*b and shared it")
    print("  out. What is left online is two subtractions, one round of broadcasts, and")
    print("  a linear combination. The cost did not disappear -- the part of it that did")
    print("  not depend on the inputs moved to a quieter time.")
    print()
    print("  Last night's run came out wrong, and it is the last term that did it.")
    print()
    _print_case(LIVE, "== this multiplication ==")

    print("== stage 1 of 4: open ==")
    print("  say what the round makes public. Two numbers, d then e.")
    print()
    print("      beaver open <d>,<e>")
    print()
    print("== stage 2 of 4: row ==")
    print("  say what YOUR row of X*Y is, assembled correctly. One number.")
    print()
    print("      beaver row <number>")
    print()
    print("== stage 3 of 4: product ==")
    print("  say what the desk should have published, instead of the number it did.")
    print()
    print("      beaver product <number>")
    print()

    print("== stage 4 of 4: transfer ==")
    if progress.transfer_unlocked():
        _print_case(
            TRANSFER,
            "== the second multiplication ==",
            (
                "another tenant's run, reviewed by you. Different field, different party",
                "count, you are a different party this time, and its implementation is",
                "faulty the other way.",
            ),
        )
        print("  all three readings at once, on one line:")
        print()
        print("      beaver transfer open=<d>,<e> row=<number> product=<number>")
        print()
    else:
        # Printed as locked rather than left out. An absent section reads as a broken
        # page, and the portal terminal has no scrollback to compare against. The
        # second multiplication's numbers stay off the screen -- that is the part
        # being gated.
        print("  [locked] a second multiplication is waiting for review: a different")
        print("  field, a different party count, you on the other side of the desk's")
        print("  convention, and an implementation that is faulty in the other")
        print("  direction. It is handed over once open, row and product are cleared.")
        print()

    _print_status()
    return 0


def _submit(stage: str, verdict) -> int:  # noqa: ANN001 - lab.judge.Verdict
    for line in verdict.lines:
        print(line)
    if verdict.passed:
        progress.record(stage)
        print()
        _print_status()
    return 0 if verdict.passed else 1


def command_open(arguments: list[str]) -> int:
    return _submit("open", check_open(SEED, LIVE, arguments))


def command_row(arguments: list[str]) -> int:
    return _submit("row", check_row(SEED, LIVE, arguments))


def command_product(arguments: list[str]) -> int:
    return _submit("product", check_product(SEED, LIVE, arguments))


def command_transfer(arguments: list[str]) -> int:
    if not progress.transfer_unlocked():
        print("the second multiplication has not been handed over yet.")
        print()
        print("  it arrives once open, row and product are cleared. Reading a run you")
        print("  have not seen is the point of it, and it is not a fourth way to attempt")
        print("  the first one.")
        print()
        _print_status()
        return 1
    return _submit("transfer", check_transfer(SEED, arguments))


def command_status() -> int:
    _print_status()
    return 0


def command_flag() -> int:
    if not progress.complete():
        print("not yet.")
        print()
        _print_status()
        print()
        print("  the flag is released once all four stages are cleared. `beaver show`")
        print("  restates the multiplication and the exact command for each stage, and")
        print("  every stage says what is not satisfied without handing over the answer.")
        return 1
    print(derive_flag(SEED))
    print()
    print("  paste that into the answer box on the problem page.")
    return 0


def _print_status() -> None:
    state = progress.load()
    print("progress:")
    for stage in progress.STAGES:
        mark = "cleared" if state[stage] else "  open "
        print(f"  [{mark}] {stage} -- {progress.STAGE_LABELS[stage]}")


COMMANDS = {
    "show": lambda arguments: command_show(),
    "open": command_open,
    "row": command_row,
    "product": command_product,
    "transfer": command_transfer,
    "status": lambda arguments: command_status(),
    "flag": lambda arguments: command_flag(),
}


def main(argv: list[str]) -> int:
    if not argv:
        print(USAGE)
        return 0
    command, arguments = argv[0], argv[1:]
    if command in ("help", "-h", "--help"):
        print(USAGE)
        return 0
    handler = COMMANDS.get(command)
    if handler is None:
        print(f"unknown command: {command}")
        print()
        print(USAGE)
        return 2
    return handler(arguments)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
