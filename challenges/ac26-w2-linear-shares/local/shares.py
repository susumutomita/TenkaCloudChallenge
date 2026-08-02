"""The whole participant surface, driven from the container terminal.

The terminal sends one line at a time and has no TTY, so every command here is a
single line with short arguments: no editor, no prompt, no multi-line paste. That
constraint shaped the interface rather than being worked around.

    shares show
    shares row 641
    shares total 2123
    shares silent e1,e4,e5,e6,e8
    shares transfer row=12 total=345 silent=g1,g3,g7
    shares flag

`shares` is a wrapper installed on PATH; `python /problem/shares.py <command>` is
the same thing, and works from any working directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved from this file rather than from the working directory: the portal's
# terminal does not promise to land in /problem, and `python shares.py` failing with
# an ImportError because of where the shell started would be an unanswerable error
# message.
sys.path.insert(0, str(HERE))

from fixtures.generate import (  # noqa: E402 - after the sys.path line, deliberately
    FAULT,
    LIVE,
    PIPELINE,
    PUBLIC,
    SHARED,
    TRANSFER,
    designated_party,
    expressions,
    field_modulus,
    flag as derive_flag,
    party_count,
    publics,
    published_total,
    your_index,
    your_rows,
)
from lab import progress  # noqa: E402
from lab.judge import check_row, check_silent, check_total, check_transfer  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

USAGE = """share desk -- what you can finish without asking anyone

  shares show
      the desk, this deployment's numbers, the two rows you hold, the pipeline the
      desk runs, and the exact command for each stage. Start here, and run it again
      whenever you lose your place.

  shares row <number>
      YOUR row of the figure the desk computes, if the pipeline is run correctly.
      One number, reduced into [0, p).

  shares total <number>
      what the desk should have published, given the number it did publish and the
      fault `shares show` describes. One number, reduced into [0, p).

  shares silent <ids>
      the expressions on the list that every party can evaluate on its own rows,
      with nobody talking. Comma separated, for example: shares silent e1,e4

  shares transfer row=<n> total=<n> silent=<ids>
      the same three readings at a second desk, handed over once the three above
      are cleared. Different field, different party count, different pipeline, and
      a fault that goes the other way.

  shares status
      what you have cleared so far

  shares flag
      prints TC{...} once all four stages are cleared. Paste it into the answer box
      on the problem page.

Every command is one line. There is no file to edit and nothing to install.
python3 is in this container if you would rather not do the arithmetic by hand:
`python3 -c "print((17 * (984 + 510)) % 4049)"`."""


def _print_case(case: str, heading: str, note: tuple[str, ...] = ()) -> None:
    p = field_modulus(SEED, case)
    n = party_count(SEED, case)
    j = your_index(SEED, case)
    t = designated_party(SEED, case)
    mine = your_rows(SEED, case)
    values = publics(SEED, case)

    print(heading)
    for line in note:
        print(f"  {line}")
    print(f"  field p = {p}, parties n = {n}. All arithmetic is modulo p, so every row")
    print(f"  and every reconstruction is an element of [0, {p}).")
    print(f"  -1 and {p - 1} are the same element.")
    print()
    print("== who you are ==")
    print(f"  you are party {j}.")
    print(f"  your row of X: {mine['x']}")
    print(f"  your row of Y: {mine['y']}")
    print("  X and Y are shared: the rows of each one sum to it modulo p, and no party")
    print("  ever sees another party's row. You will not be shown one either.")
    print()
    print("== the values everyone already knows ==")
    print(f"  k = {values['k']}    c = {values['c']}")
    print()
    print("== the desk's run sheet ==")
    print(f"  {PIPELINE[case]}")
    print("     add(A, B)      every party adds its own row of A to its own row of B")
    print("     mulpub(A, k)   every party multiplies its own row of A by k")
    print(f"     addpub(A, c)   the public constant is folded in by party {t}, and by")
    print(f"                    party {t} alone. That is this desk's convention.")
    print()
    print("== what the desk actually published ==")
    print(f"  published total = {published_total(SEED, case)}")
    print(f"  the previous SRE's implementation was faulty: {FAULT[case]}.")
    print("  so that number is the reconstruction of a run that did the wrong thing.")
    print()


def _print_expressions(case: str) -> None:
    print("== the operations queue ==")
    print("  the desk has these queued against shared values. Some of them every party")
    print("  can evaluate on its own rows, with nobody talking. Some cannot be done that")
    print("  way at all.")
    print(f"    shared, nobody holds them in the clear: {', '.join(SHARED)}")
    print(f"    public, everybody knows them:           {', '.join(PUBLIC)}")
    print()
    for row in expressions(SEED, case):
        print(f"    {row['id']:<4} {row['text']}")
    print()


def command_show() -> int:
    print("== the desk ==")
    print("  three sites pool one figure each into a joint report without any of them")
    print("  handing over its own number. Every value the desk holds is split into one")
    print("  row per party, and the rows are useless apart. The report still comes out,")
    print("  because most of what the desk does to those rows can be done by each party")
    print("  alone -- which is the only reason this is affordable.")
    print()
    print("  This morning's figure came out wrong. The pipeline is unchanged, the inputs")
    print("  are unchanged, and every step of it is linear. You are the party being asked")
    print("  what the number should have been.")
    print()
    _print_case(LIVE, "== your desk ==")
    _print_expressions(LIVE)

    print("== stage 1 of 4: row ==")
    print("  say what YOUR row of Z is, if the pipeline is run correctly. One number.")
    print()
    print("      shares row <number>")
    print()
    print("== stage 2 of 4: total ==")
    print("  say what the desk should have published, instead of the number it did.")
    print()
    print("      shares total <number>")
    print()
    print("== stage 3 of 4: silent ==")
    print("  name every expression on the queue that finishes without anyone talking.")
    print()
    print("      shares silent <ids>")
    print()

    print("== stage 4 of 4: transfer ==")
    if progress.transfer_unlocked():
        _print_case(
            TRANSFER,
            "== the second desk ==",
            (
                "another tenant's desk, reviewed by you. Different field, different party",
                "count, the constant sits somewhere else in the pipeline, you are a",
                "different party this time, and its implementation is faulty the other way.",
            ),
        )
        _print_expressions(TRANSFER)
        print("  all three readings at once, on one line:")
        print()
        print("      shares transfer row=<number> total=<number> silent=<ids>")
        print()
    else:
        # Printed as locked rather than left out. An absent section reads as a broken
        # page, and the portal terminal has no scrollback to compare against. The
        # second desk's numbers stay off the screen -- that is the part being gated.
        print("  [locked] a second desk is waiting for review: a different field, a")
        print("  different party count, the constant in a different place, and an")
        print("  implementation that is faulty in the other direction. It is handed over")
        print("  once row, total and silent are cleared.")
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


def command_row(arguments: list[str]) -> int:
    return _submit("row", check_row(SEED, LIVE, arguments))


def command_total(arguments: list[str]) -> int:
    return _submit("total", check_total(SEED, LIVE, arguments))


def command_silent(arguments: list[str]) -> int:
    return _submit("silent", check_silent(SEED, LIVE, arguments))


def command_transfer(arguments: list[str]) -> int:
    if not progress.transfer_unlocked():
        print("the second desk has not been handed over yet.")
        print()
        print("  it arrives once row, total and silent are cleared. Reading a desk you")
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
        print("  the flag is released once all four stages are cleared. `shares show`")
        print("  restates the desk and the exact command for each stage, and every stage")
        print("  says what is not satisfied without handing over the answer.")
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
    "row": command_row,
    "total": command_total,
    "silent": command_silent,
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
