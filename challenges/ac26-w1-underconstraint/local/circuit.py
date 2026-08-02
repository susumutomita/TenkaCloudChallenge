"""The whole participant surface, driven from the container terminal.

The terminal sends one line at a time and has no TTY, so every command here is a
single line with short arguments: no editor, no prompt, no multi-line paste. That
constraint shaped the interface rather than being worked around.

    circuit show
    circuit check revoked=58 inv=0 ok=1 issuer_ok=1 granted=1
    circuit repair "revoked*ok"
    circuit flag

`circuit` is a wrapper installed on PATH; `python /problem/circuit.py <command>`
is the same thing, and works from any working directory.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved from this file rather than from the working directory: the portal's
# terminal does not promise to land in /problem, and `python circuit.py` failing
# with ImportError because of where the shell started would be an unanswerable
# error message.
sys.path.insert(0, str(HERE))

from fixtures.generate import (  # noqa: E402 - after the sys.path line, deliberately
    KIND_RESIDUALS,
    SIGNALS,
    deployed_circuit,
    flag as derive_flag,
    honest_witnesses,
    params,
)
from lab import progress  # noqa: E402
from lab.judge import check_repair, check_witness  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

USAGE = """underconstraint lab -- the credential circuit that passed its tests

  circuit show
      the policy, this deployment's parameters, the circuit that is deployed,
      and the two honest witnesses a repair has to keep accepting

  circuit check revoked=<n> inv=<n> ok=<n> issuer_ok=<n> granted=<n>
      submit a forged witness. It has to satisfy the DEPLOYED circuit and assert
      a `granted` the policy says is wrong. Anything else is explained, not just
      refused.

  circuit repair "<expression>"
      submit the constraint the deployed circuit is missing, written as the
      residual that must come out zero -- for example "a*b + c - 1". Quote it:
      `*` is a shell glob. Checked for keeping the honest cases and for being
      minimal, not just for stopping your own forgery.

  circuit status
      what you have cleared so far

  circuit flag
      prints TC{...} once check and repair have both passed. Paste it into the
      answer box on the problem page.

Every command is one line. There is no file to edit and nothing to install."""


def command_show() -> int:
    prm = params(SEED)
    p = prm["p"]
    print("== the policy ==")
    print("  grant access iff the revocation counter is zero AND the issuer is recognised")
    print()
    print("== this deployment's parameters ==")
    print(f"  {json.dumps(prm)}")
    print(f"  arithmetic is modulo p = {p}; this credential's counter is {prm['revoked']}, so it")
    print("  really is revoked, and an honest holder of it is denied.")
    print()
    print("== the circuit that is deployed ==")
    for constraint in deployed_circuit(SEED):
        print(f"  {json.dumps(constraint)}")
    print()
    print("  One constraint the policy needs is not in that list.")
    print()
    print("== how to read a constraint ==")
    print("  each one is a residual that must be 0 for a witness to be accepted:")
    for kind, formula in KIND_RESIDUALS.items():
        print(f"    {kind:<10} {formula}")
    print()
    print("  a circuit has no comparison and no division. 'is this signal zero' is asserted")
    print("  with a helper signal `inv` that the prover supplies, and it takes two constraints.")
    print()
    print("== honest witnesses (both must still be accepted after your repair) ==")
    for label, witness in zip(("revoked holder", "clean holder "), honest_witnesses(prm)):
        rendered = " ".join(f"{name}={witness[name]}" for name in SIGNALS)
        print(f"  {label}: {rendered}")
    print()
    print("== your next command ==")
    print("  circuit check revoked=<n> inv=<n> ok=<n> issuer_ok=<n> granted=<n>")
    print()
    _print_status()
    return 0


def command_check(arguments: list[str]) -> int:
    verdict = check_witness(SEED, arguments)
    for line in verdict.lines:
        print(line)
    if verdict.passed:
        progress.record("check")
        print()
        _print_status()
    return 0 if verdict.passed else 1


def command_repair(arguments: list[str]) -> int:
    verdict = check_repair(SEED, arguments)
    for line in verdict.lines:
        print(line)
    if verdict.passed:
        progress.record("repair")
        print()
        _print_status()
    return 0 if verdict.passed else 1


def command_status() -> int:
    _print_status()
    return 0


def command_flag() -> int:
    if not progress.complete():
        print("not yet.")
        print()
        _print_status()
        print()
        print("  the flag is released once both stages are cleared. `circuit show` restates")
        print("  the parameters; `circuit check` and `circuit repair` explain what is missing")
        print("  from an attempt without giving the answer away.")
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
    if command == "check":
        return command_check(arguments)
    if command == "repair":
        return command_repair(arguments)
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
