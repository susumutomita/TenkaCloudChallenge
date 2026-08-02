"""The whole participant surface, driven from the container terminal.

This is the first problem in the track, so it is also the first terminal anyone
here opens. The terminal sends one line at a time and has no TTY: no editor, no
prompt, no multi-line paste, no arrow keys. Every command below is therefore a
single short line, and `counter show` is written to be the only thing anyone needs
to read to know what the problem is and what to type next.

    counter show
    counter predict 4
    counter locate 2
    counter rule "(start + step*rounds) % modulus"
    counter transfer predict=1 locate=3
    counter flag

`counter` is a wrapper installed on PATH; `python /problem/counter.py <command>` is
the same thing, and works from any working directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved from this file rather than from the working directory: the portal's
# terminal does not promise to land in /problem, and `python counter.py` failing
# with an ImportError because of where the shell started would be an unanswerable
# error message for someone on their first terminal command.
sys.path.insert(0, str(HERE))

from fixtures.generate import (  # noqa: E402 - after the sys.path line, deliberately
    PARAMETERS,
    broken_case,
    flag as derive_flag,
    main_case,
    transfer_broken_case,
    transfer_case,
)
from lab import progress  # noqa: E402
from lab.judge import check_locate, check_predict, check_rule, check_transfer  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

USAGE = """experiment lab -- predict it, read it, then write the rule

  counter show
      what the counter is, this deployment's numbers, and the exact command for
      each stage. Start here. Run it again whenever you lose your place.

  counter predict <number>
      where the counter stands after its last round. Work it out on paper first:
      the trace stays hidden until the prediction is right.

  counter locate <index>
      the FIRST entry of the broken trace that leaves the window [0, modulus).
      Entries are numbered from 0.

  counter rule "<expression>"
      one line that gives the final value for parameters you have not been shown.
      Quote it: `*` is a shell glob.

  counter transfer predict=<number> locate=<index>
      the same two readings, on a counter that runs backwards. Unlocks once the
      three above are cleared.

  counter status
      what you have cleared so far

  counter flag
      prints TC{...} once all four are cleared. Paste it into the answer box on
      the problem page.

Every command is one line. There is no file to edit and nothing to install."""


def command_show() -> int:
    main = main_case(SEED)
    broken, broken_trace, _ = broken_case(SEED)

    print("== the counter ==")
    print("  a counter starts somewhere, advances by a fixed step, and after every round is")
    print("  brought back into the window [0, modulus). One round is:")
    print()
    print("      value <- value + step, brought back into [0, modulus)")
    print()
    print("  the promise: EVERY value the counter takes is inside [0, modulus). The whole")
    print("  problem is that promise -- predicting it, checking it, and writing it down.")
    print()

    print("== stage 1 of 4: predict ==")
    print(f"  this deployment's case: {main.rendered()}")
    print("  work out on paper where the counter stands after the last round, then:")
    print()
    print("      counter predict <number>")
    print()
    print("  the trace is printed once the prediction is right, and not before. A number")
    print("  copied out of an answer measures nothing.")
    print()

    print("== stage 2 of 4: locate ==")
    print("  the trace below came out of a DIFFERENT run of the same kind of counter, from an")
    print("  implementation that got it wrong. More than one entry leaves the window, so the")
    print("  question is which one leaves it FIRST -- that is the one that points at the fault.")
    print(f"      {broken.rendered()}")
    print(f"      trace = {broken_trace}")
    print(f"      entries are numbered from 0, so this one has entries 0 to {len(broken_trace) - 1}")
    print(f"  say which entry is the FIRST one outside [0, {broken.modulus}):")
    print()
    print("      counter locate <index>")
    print()

    print("== stage 3 of 4: rule ==")
    print("  write ONE line that gives the final value -- not for the case above, but for")
    print("  parameters you have not been shown.")
    print(f"      names:     {', '.join(PARAMETERS)}")
    print("      operators: + - * % ( ) and whole numbers")
    print("      `%` is the remainder that always lands in [0, modulus), even below zero")
    print()
    print('      counter rule "<expression>"')
    print()
    print("  quote it: `*` is a shell glob. It is graded by agreeing with the counter over a")
    print("  family of parameter sets, so a rule written for one case does not pass.")
    print()

    print("== stage 4 of 4: transfer ==")
    if progress.transfer_unlocked():
        case = transfer_case(SEED)
        broken_transfer, transfer_trace, _ = transfer_broken_case(SEED)
        print("  the same counter, running backwards. Both readings again, on one line.")
        print(f"      predict this case: {case.rendered()}")
        print(f"      and locate the first break in this trace, from a broken implementation:")
        print(f"      {broken_transfer.rendered()}")
        print(f"      trace = {transfer_trace}")
        print()
        print("      counter transfer predict=<number> locate=<index>")
        print()
    else:
        print("  locked. Clear the three stages above, then run `counter show` again and the")
        print("  fourth case appears here.")
        print()

    _print_status()
    return 0


def _stage_command(stage: str, arguments: list[str], judge) -> int:
    verdict = judge(SEED, arguments)
    for line in verdict.lines:
        print(line)
    if verdict.passed:
        progress.record(stage)
        print()
        _print_status()
    return 0 if verdict.passed else 1


def command_predict(arguments: list[str]) -> int:
    return _stage_command("predict", arguments, check_predict)


def command_locate(arguments: list[str]) -> int:
    return _stage_command("locate", arguments, check_locate)


def command_rule(arguments: list[str]) -> int:
    return _stage_command("rule", arguments, check_rule)


def command_transfer(arguments: list[str]) -> int:
    if not progress.transfer_unlocked():
        print("the transfer case is not open yet.")
        print()
        _print_status()
        print()
        print("  it is the same subject with different numbers, and it is only worth")
        print("  anything once the first three have been done the slow way. Clear them,")
        print("  then `counter show` prints the fourth case.")
        return 1
    return _stage_command("transfer", arguments, check_transfer)


def command_status() -> int:
    _print_status()
    return 0


def command_flag() -> int:
    if not progress.complete():
        print("not yet.")
        print()
        _print_status()
        print()
        print("  the flag is released once all four are cleared. `counter show` restates the")
        print("  case and the exact command for each stage, and every stage explains what is")
        print("  missing from an attempt without handing over the answer.")
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
    "predict": command_predict,
    "locate": command_locate,
    "rule": command_rule,
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
