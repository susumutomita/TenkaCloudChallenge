"""The whole participant surface, driven from the container terminal.

The terminal sends one line at a time and has no TTY: no editor, no prompt, no
multi-line paste, no arrow keys. Every command below is therefore a single short line,
and `shares show` is written to be the only thing anyone needs to read to know what the
problem is and what to type next.

    shares show
    shares recover 90
    shares complete "(target - known) % modulus"
    shares refresh 3,5,9,84,8
    shares transfer recover=38 complete=19 refresh=7,11,4,81
    shares flag

`shares` is a wrapper installed on PATH; `python /problem/shares.py <command>` is the
same thing, and works from any working directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved from this file rather than from the working directory: the portal's terminal
# does not promise to land in /problem, and `python shares.py` failing with an
# ImportError because of where the shell started would be an unanswerable error message.
sys.path.insert(0, str(HERE))

from fixtures.generate import (  # noqa: E402 - after the sys.path line, deliberately
    LIVE,
    PARAMETERS,
    TRANSFER,
    flag as derive_flag,
    ledger_a,
    ledger_b,
    setting,
    target_value,
)
from lab import progress  # noqa: E402
from lab.judge import (  # noqa: E402
    check_complete,
    check_recover,
    check_refresh,
    check_transfer,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

USAGE = """sharing lab -- it adds up, and that is not the same as keeping a secret

  shares show
      what a sharing is, this deployment's ledgers, and the exact command for each
      stage. Start here. Run it again whenever you lose your place.

  shares recover <total>
      the total of the ledger whose every share is on screen.

  shares complete "<expression>"
      one line giving the missing share, for a target and a set of visible shares
      you have NOT been shown. Quote it: `*` is a shell glob.

  shares refresh <o0>,<o1>,...
      offsets, one per party, that leave the total where it is and move every
      single share. Commas, no spaces.

  shares transfer recover=<n> complete=<n> refresh=<o0>,...
      the same three, on a modulus and a party count you have not seen. Unlocks
      once the three above are cleared.

  shares status
      what you have cleared so far

  shares flag
      prints TC{...} once all four are cleared. Paste it into the answer box on the
      problem page.

Every command is one line. There is no file to edit and nothing to install."""


def _print_status() -> None:
    state = progress.load()
    print("progress:")
    for stage in progress.STAGES:
        mark = "cleared" if state[stage] else "  open "
        print(f"  [{mark}] {stage} -- {progress.STAGE_LABELS[stage]}")


# --------------------------------------------------------------------------- show


def command_show() -> int:
    cfg = setting(SEED, LIVE)
    a = ledger_a(SEED, LIVE)
    b = ledger_b(SEED, LIVE)

    print("== the sharing ==")
    print("  five auditors need the total across their books without any of them learning")
    print("  another's figures. A number is split into one value per party, and only the")
    print("  values added together mean anything:")
    print()
    print("      the shares of s are n values with   s = s_0 + s_1 + ... + s_{n-1}  (mod p)")
    print()
    print("  that arithmetic is three lines. What makes it cryptography is the other half:")
    print("  ANY n-1 of those values are independent of the secret. That is a claim to be")
    print("  demonstrated, not asserted, and demonstrating it is what this lab is.")
    print()

    print("== the version already on the whiteboard ==")
    print("  your predecessor's split: party 0 gets the whole total, everybody else gets 0.")
    print("  It adds up. Every test of 'does it come back' passes. Party 0 knew everything")
    print("  from the start. 'It adds up' and 'it keeps a secret' are different sentences,")
    print("  and every stage below is about the second one.")
    print()

    print("== this deployment ==")
    print(f"  {cfg.rendered()}")
    print()

    print("== stage 1 of 4: recover ==")
    print(f"  ledger A, all {cfg.n} shares exactly as the parties hold them:")
    print(f"      {list(a.shares)}")
    print(f"  add them up and bring the total back into [0, {cfg.p}).")
    print()
    print("      shares recover <total>")
    print()
    print("  this is the round trip, and it is the easy one. It is here for the contrast")
    print("  with the next stage: this view fixes the total exactly.")
    print()

    print("== stage 2 of 4: complete ==")
    print(f"  ledger B is a different total, and one share is missing -- party {b.missing}'s.")
    print(f"      the other parties hold:  {list(b.visible())}")
    print(f"      their raw sum:           known = {b.known()}")
    print(f"      (raw: not reduced. It is larger than {cfg.p} and that is the point.)")
    print()
    print("  the question is NOT what ledger B's total is. It is this: given any target at")
    print(f"  all, can you always choose party {b.missing}'s share so that the ledger adds up to")
    print("  that target? If you can -- for every element of the field -- then those")
    print(f"  {cfg.n - 1} values rule out nothing, and they are not evidence about the total.")
    print()
    print("  write it as ONE line, for a target and a `known` you have not been shown:")
    print(f"      names:     {', '.join(PARAMETERS)}")
    print("      operators: + - * % ( ) and whole numbers")
    print("      `%` is the remainder that always lands in [0, modulus), even below zero")
    print()
    print('      shares complete "<expression>"')
    print()
    print("  quote it: `*` is a shell glob. It is graded by agreeing over a family of")
    print("  (target, known, modulus) -- including known = 0, which is exactly what every")
    print("  party except party 0 sees under the whiteboard split -- so a rule written for")
    print("  the numbers above does not pass.")
    print()

    print("== stage 3 of 4: refresh ==")
    print("  the same secret, carried by a different set of shares. Give one offset per")
    print("  party, to be added share by share:")
    print(f"      the total must not move, and every one of the {cfg.n} shares must.")
    print()
    print(f"      shares refresh <o0>,...,<o{cfg.n - 1}>      ({cfg.n} numbers, commas, no spaces)")
    print()

    print("== stage 4 of 4: transfer ==")
    if progress.transfer_unlocked():
        second = setting(SEED, TRANSFER)
        a2 = ledger_a(SEED, TRANSFER)
        b2 = ledger_b(SEED, TRANSFER)
        target = target_value(SEED, TRANSFER)
        print("  a second setting, and the same three questions.")
        print(f"      {second.rendered()}")
        print(f"      ledger A, every share:   {list(a2.shares)}")
        print(f"      ledger B, party {b2.missing} missing: {list(b2.visible())}")
        print(f"      land ledger B on the total {target}.")
        print("      (no pre-computed sum this time. Add them yourself.)")
        print()
        print(f"      shares transfer recover=<n> complete=<n> refresh=<o0>,...,<o{second.n - 1}>")
        print()
    else:
        print("  locked. Clear the three stages above, then run `shares show` again and the")
        print("  second setting appears here.")
        print()

    _print_status()
    return 0


# --------------------------------------------------------------------------- stages


def _stage_command(stage: str, arguments: list[str], judge) -> int:
    verdict = judge(SEED, arguments)
    for line in verdict.lines:
        print(line)
    if verdict.passed:
        progress.record(stage)
        print()
        _print_status()
    return 0 if verdict.passed else 1


def command_transfer(arguments: list[str]) -> int:
    if not progress.transfer_unlocked():
        print("the second setting is not open yet.")
        print()
        _print_status()
        print()
        print("  it is the same three questions on numbers you have not seen, and it is")
        print("  only worth anything once the first three have been done the slow way.")
        print("  Clear them, then `shares show` prints the second setting.")
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
        print("  the flag is released once all four are cleared. `shares show` restates the")
        print("  ledgers and the exact command for each stage, and every stage explains what")
        print("  is missing from an attempt without handing over the answer.")
        return 1
    print(derive_flag(SEED))
    print()
    print("  paste that into the answer box on the problem page.")
    return 0


COMMANDS = {
    "show": lambda arguments: command_show(),
    "recover": lambda arguments: _stage_command("recover", arguments, check_recover),
    "complete": lambda arguments: _stage_command("complete", arguments, check_complete),
    "refresh": lambda arguments: _stage_command("refresh", arguments, check_refresh),
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
