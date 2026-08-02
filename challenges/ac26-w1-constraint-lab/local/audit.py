"""The whole participant surface, driven from the container terminal.

The terminal sends one line at a time and has no TTY, so every command here is a
single line with short arguments: no editor, no prompt, no multi-line paste. That
constraint shaped the interface rather than being worked around.

    audit show
    audit explain c2
    audit trace 0,3,125,0,0
    audit admit "(tier - 62)*(tier - 114)"
    audit transfer 0,56,89,0,0,64
    audit flag

`audit` is a wrapper installed on PATH; `python /problem/audit.py <command>` is the
same thing, and works from any working directory.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved from this file rather than from the working directory: the portal's
# terminal does not promise to land in /problem, and `python audit.py` failing with
# ImportError because of where the shell started would be an unanswerable error
# message.
sys.path.insert(0, str(HERE))

from fixtures.evaluator import formula  # noqa: E402 - after the sys.path line, deliberately
from fixtures.generate import (  # noqa: E402
    KIND_RESIDUALS,
    LIVE,
    SIGNALS,
    TRANSFER,
    allowed_set,
    circuit,
    failing_witness,
    field_modulus,
    flag as derive_flag,
    honest_witness,
)
from lab import progress  # noqa: E402
from lab.judge import MEMBERSHIP_SIGNAL, check_admit, check_trace  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

USAGE = """constraint lab -- the audit tool that only ever printed PASS or FAIL

  audit show
      this deployment's field, how to read a constraint, the circuit, a witness
      that satisfies it, and the witness the monitor refused

  audit explain <id>
      one constraint's residual with its operands named -- the expression that has
      to come out zero, not its value

  audit trace <r0>,<r1>,...
      the residual of every constraint, in circuit order, for the witness the
      monitor refused. Each one reduced into [0, p).

  audit admit "<expression>"
      the residual that is zero on exactly the licensed tiers and non-zero on every
      other element of the field. Quote it: `*` is a shell glob.

  audit transfer <r0>,<r1>,...
      the same trace, on a second circuit handed over once the two stages above are
      cleared. Different field, different signals, different order.

  audit status
      what you have cleared so far

  audit flag
      prints TC{...} once all three stages are cleared. Paste it into the answer
      box on the problem page.

Every command is one line. There is no file to edit and nothing to install."""


def _render(witness: dict[str, int], case: str) -> str:
    return " ".join(f"{name}={witness[name]}" for name in SIGNALS[case])


def _print_kind_table(circ: list[dict]) -> None:
    print("== how to read a constraint ==")
    print("  each one is a residual that must be 0 for a witness to satisfy the circuit:")
    printed: set[str] = set()
    for constraint in circ:
        kind = str(constraint["kind"])
        if kind in printed:
            continue
        printed.add(kind)
        print(f"    {kind:<10} {KIND_RESIDUALS[kind]}")
    print()
    print("  a circuit is not a program: nothing runs in order, and there is no comparison.")
    print("  every constraint is imposed on the whole witness at once.")
    print()


def _print_case(case: str, heading: str, note: tuple[str, ...] = ()) -> None:
    p = field_modulus(SEED, case)
    circ = circuit(SEED, case)
    print(heading)
    for line in note:
        print(f"  {line}")
    print(f"  arithmetic is modulo p = {p}, so every residual is an element of [0, {p}).")
    print(f"  -1 and {p - 1} are the same element, and neither of them is 0.")
    print()
    _print_kind_table(circ)
    print("== the circuit ==")
    for constraint in circ:
        print(f"  {json.dumps(constraint)}")
    print()
    print("  `audit explain <id>` prints any one of them with its operands named.")
    print()
    print("== a witness that satisfies it ==")
    print(f"  {_render(honest_witness(SEED, case), case)}")
    print("  every residual of this one is 0. Work that out before you trust anything below.")
    print()
    print("== the witness the monitor refused ==")
    print(f"  {_render(failing_witness(SEED, case), case)}")
    print("  it printed FAIL and stopped. More than one constraint is not satisfied.")
    print()


def command_show() -> int:
    print("== the audit tool ==")
    print("  the policy engine decides access with an arithmetic circuit rather than with")
    print("  if-statements, so any decision can be re-checked afterwards by anyone. The")
    print("  monitor prints one word, PASS or FAIL. You are the part that says why.")
    print()
    _print_case(LIVE, "== this deployment ==")
    print("== the constraint nobody has written yet ==")
    print(f"  a signal `{MEMBERSHIP_SIGNAL}` has to be one of the licensed values:")
    print(f"    {allowed_set(SEED, LIVE)}")
    print("  there is no kind for that in the table above, and no constraint for it in the")
    print("  circuit. Naming the signal does not bind it -- a constraint does. Write the")
    print("  residual that is zero on exactly those values and non-zero on every other")
    print("  element of the field.")
    print()

    if progress.transfer_unlocked():
        _print_case(
            TRANSFER,
            "== the second circuit, from another tenant ==",
            (
                "different field, different signals, one more constraint, and the order is",
                "not the one you got used to. It also carries the membership gadget as a",
                "deployed constraint, so reading it means evaluating what you just wrote.",
            ),
        )
        print("== your next command ==")
        print(
            f"  audit transfer <r0>,...  ({len(circuit(SEED, TRANSFER))} residuals, in circuit order)"
        )
    else:
        # Printed as locked rather than left out. An absent section reads as a broken
        # page; a locked one says the stage exists and what opens it. The circuit
        # itself stays off the screen -- that is the part being gated.
        print("== the second circuit, from another tenant == [locked]")
        print("  a second circuit is waiting for review: a different field, different")
        print("  signals, a different order, and the membership gadget as a deployed")
        print("  constraint. It is handed over once `trace` and `admit` are cleared.")
        print()
        print("== your next command ==")
        print(f"  audit trace <r0>,...  ({len(circuit(SEED, LIVE))} residuals, in circuit order)")
        print('  audit admit "<expression>"')
    print()
    _print_status()
    return 0


def command_explain(arguments: list[str]) -> int:
    if not arguments:
        print("usage: audit explain <constraint id>")
        return 2
    wanted = arguments[0].strip()
    for case in (LIVE, TRANSFER):
        for constraint in circuit(SEED, case):
            if str(constraint["id"]) != wanted:
                continue
            if case == TRANSFER and not progress.transfer_unlocked():
                print(f"{wanted} is in a circuit you have not been handed yet.")
                print()
                _print_status()
                return 1
            print(f"{wanted}  {constraint['kind']}")
            print(f"  residual: {formula(constraint)}")
            print(f"  it is satisfied exactly when that is 0 modulo {field_modulus(SEED, case)}.")
            return 0
    print(f"no constraint with id {wanted!r}. `audit show` lists them.")
    return 1


def _submit(stage: str, verdict) -> int:
    for line in verdict.lines:
        print(line)
    if verdict.passed:
        progress.record(stage)
        print()
        _print_status()
    return 0 if verdict.passed else 1


def command_trace(arguments: list[str]) -> int:
    return _submit("trace", check_trace(SEED, LIVE, arguments))


def command_admit(arguments: list[str]) -> int:
    return _submit("admit", check_admit(SEED, arguments))


def command_transfer(arguments: list[str]) -> int:
    if not progress.transfer_unlocked():
        print("the second circuit has not been handed over yet.")
        print()
        print(
            "  it arrives once `trace` and `admit` are cleared. Reading an unfamiliar"
        )
        print("  circuit is the point of it, and it is not a fourth way to attempt the")
        print("  first one.")
        print()
        _print_status()
        return 1
    return _submit("transfer", check_trace(SEED, TRANSFER, arguments))


def command_status() -> int:
    _print_status()
    return 0


def command_flag() -> int:
    if not progress.complete():
        print("not yet.")
        print()
        _print_status()
        print()
        print("  the flag is released once all three stages are cleared. `audit show`")
        print("  restates the circuit; `audit explain <id>` restates one constraint; the")
        print("  stages say what is not satisfied without giving the answer away.")
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


def main(argv: list[str]) -> int:
    if not argv:
        print(USAGE)
        return 0
    command, arguments = argv[0], argv[1:]
    if command in ("help", "-h", "--help"):
        print(USAGE)
        return 0
    if command == "show":
        return command_show()
    if command == "explain":
        return command_explain(arguments)
    if command == "trace":
        return command_trace(arguments)
    if command == "admit":
        return command_admit(arguments)
    if command == "transfer":
        return command_transfer(arguments)
    if command == "status":
        return command_status()
    if command == "flag":
        return command_flag()
    print(f"unknown command: {command}")
    print()
    print(USAGE)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
