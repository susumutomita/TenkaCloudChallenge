"""The whole participant surface, driven from the container terminal.

The terminal sends one line at a time and has no TTY: no editor, no prompt, no
multi-line paste, no arrow keys. Every command below is therefore a single short line,
and `review show` is written to be the only thing anyone needs to read to know what the
problem is and what to type next.

    review show
    review run p2 41
    review reject 12
    review recover 41
    review forge 148
    review classify p1=sound,private p2=complete,private p3=complete,sound
    review transfer reject=52 recover=38 forge=-89
    review flag

`review` is a wrapper installed on PATH; `python /problem/review.py <command>` is the
same thing, and works from any working directory.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved from this file rather than from the working directory: the portal's terminal
# does not promise to land in /problem, and `python review.py` failing with an
# ImportError because of where the shell started would be an unanswerable error message.
sys.path.insert(0, str(HERE))

from fixtures.generate import (  # noqa: E402 - after the sys.path line, deliberately
    AUDIT_NOTE,
    LIVE,
    PROPERTIES,
    TRANSFER,
    accepts,
    flag as derive_flag,
    record,
)
from lab import progress  # noqa: E402
from lab.judge import (  # noqa: E402
    checked_panel,
    check_classify,
    check_forge,
    check_recover,
    check_reject,
    check_transfer,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

USAGE = """property audit -- three verifiers, three properties, and which is which

  review show
      the claim, this deployment's statements, what each verifier checks and what
      it wrote down, and the exact command for each stage. Start here. Run it again
      whenever you lose your place.

  review run <verifier> <w>
      run one verifier on BOTH statements and print its verdict and its record.
      Runs are FREE -- nothing is scored and nothing is recorded. Use it.

  review reject <w>
      a witness the edge statement is TRUE of that one of them refuses.

  review recover <w>
      the value the honest run of the main statement used, read out of a record.

  review forge <w>
      a witness the main statement is FALSE of that one of them accepts. It may be
      negative.

  review classify <id>=<properties> ...
      for each verifier, the properties it STILL HOLDS, comma-separated, or `none`.
      Opens once the three demonstrations above are done.

  review transfer reject=<w> recover=<w> forge=<w>
      the same three demonstrations on a second panel. Opens once the first four
      stages are cleared.

  review status
      what you have cleared so far

  review flag
      prints TC{...} once all five are cleared. Paste it into the answer box on the
      problem page.

Every command is one line. There is no file to edit and nothing to install."""


# --------------------------------------------------------------------------- show


def _print_claim() -> None:
    print("== the claim ==")
    print("  every verifier here is handed the same kind of statement:")
    print()
    print("      'I know w with   a*w + b == c  (mod p)   and   lo <= w <= hi'")
    print()
    print("  three things can be asked of a verifier for that claim:")
    print("      complete   every w the statement is TRUE of is accepted")
    print("      sound      no w the statement is FALSE of is accepted")
    print("      private    the record a run leaves says nothing about w")
    print()
    print("  the three are independent. A verifier can hold any subset of them, and each")
    print("  one on this panel breaks exactly one and holds the other two.")
    print()


def _print_panel(panel_, heading: str, note: tuple[str, ...] = ()) -> None:
    print(heading)
    for line in note:
        print(f"  {line}")
    print(f"  main statement: {panel_.main.rendered()}")
    print(f"  edge statement: {panel_.edge.rendered()}")
    print("      the edge statement's honest witness sits exactly on ONE END of its")
    print("      range. Which end is for you to find.")
    print()
    print("  each verifier, what it checks, and what it left behind on the honest run of")
    print("  the main statement:")
    for verifier in panel_.verifiers:
        print(f"    {verifier.id}  congruence, and range: {verifier.range_text()}")
        entry = record(verifier, panel_.main, panel_.main.witness)
        print(f"        record: {json.dumps(entry)}")
        audit = entry.get("audit")
        if isinstance(audit, dict):
            for key in audit:
                print(f"        ({key} is {AUDIT_NOTE[key]})")
    print()


def command_show() -> int:
    live = checked_panel(SEED, LIVE)

    print("== the audit ==")
    print("  three toy verifiers arrive from three different teams. All three shipped, all")
    print("  three passed their own tests. The job is not to say which one is buggy -- they")
    print("  all are. It is to say what each one STILL guarantees, and to prove each claim.")
    print()
    _print_claim()
    _print_panel(live, "== this deployment's panel ==")

    print("== trying things costs nothing ==")
    print("      review run <verifier> <w>")
    print("  runs one verifier on both statements and prints the verdict and the record.")
    print("  Runs are not scored and are not recorded -- test a candidate before you")
    print("  submit it. Only the five stages below are scored.")
    print()

    print("== stage 1 of 5: reject ==")
    print("  a completeness break: a witness one of the two statements above is TRUE of,")
    print("  that one of the three refuses anyway. Only one of the two statements can")
    print("  show it, and the note about where its honest witness sits is why.")
    print()
    print("      review reject <w>")
    print()

    print("== stage 2 of 5: recover ==")
    print("  a privacy break: the value the honest run of the MAIN statement used. Not")
    print("  'the record looks suspicious' -- the number itself, read back out of it.")
    print()
    print("      review recover <w>")
    print()

    print("== stage 3 of 5: forge ==")
    print("  a soundness break: a witness the MAIN statement is FALSE of, that one of the")
    print("  three accepts anyway. It may be negative.")
    print()
    print("      review forge <w>")
    print()

    print("== stage 4 of 5: classify ==")
    if progress.classify_unlocked():
        print("  for each verifier, the properties it STILL HOLDS -- comma-separated, or")
        print("  `none`. The three breaks you produced are three of the nine entries; the")
        print("  other six are the question.")
        print()
        print("      review classify " + " ".join(f"{i}=<properties>" for i in live.ids()))
        print(f"      properties: {', '.join(PROPERTIES)}")
        print()
    else:
        print("  locked. A label nobody can demonstrate is exactly what this problem is")
        print("  about, so the classification opens once reject, recover and forge are all")
        print("  cleared.")
        print()

    print("== stage 5 of 5: transfer ==")
    if progress.transfer_unlocked():
        second = checked_panel(SEED, TRANSFER)
        _print_panel(
            second,
            "  a second panel, from another audit:",
            (
                "different statements, the defects on different verifiers, and each of",
                "them wearing a different flavour. `review run` works on these too.",
            ),
        )
        print("      review transfer reject=<w> recover=<w> forge=<w>")
        print()
    else:
        print("  locked. A second panel is waiting: different statements, the defects on")
        print("  different verifiers, each in a different flavour. It is handed over once")
        print("  the four stages above are cleared.")
        print()

    _print_status()
    return 0


# --------------------------------------------------------------------------- run


def command_run(arguments: list[str]) -> int:
    """Run one verifier on both of its panel's statements. Free, and not recorded."""
    if len(arguments) != 2:
        print("usage: review run <verifier> <w>")
        print()
        print("  for example:  review run p1 12")
        return 2
    wanted = arguments[0].strip()
    try:
        w = int(arguments[1].strip(), 10)
    except ValueError:
        print(f"{arguments[1]!r} is not a whole number.")
        return 2

    live = checked_panel(SEED, LIVE)
    verifier = live.by_id(wanted)
    panel_ = live
    if verifier is None:
        second = checked_panel(SEED, TRANSFER)
        candidate = second.by_id(wanted)
        if candidate is not None and not progress.transfer_unlocked():
            print(f"{wanted} is on a panel that has not been handed over yet.")
            print()
            _print_status()
            return 1
        verifier, panel_ = candidate, second
    if verifier is None:
        print(f"no verifier called {wanted!r}. `review show` lists them.")
        return 1

    print(f"{verifier.id}  checks the congruence, and range: {verifier.range_text()}")
    for statement in panel_.statements():
        verdict = "ACCEPT" if accepts(verifier, statement, w) else "REJECT"
        print(f"  {statement.name} statement ({statement.rendered()})")
        print(f"    w = {w}  ->  {verdict}")
        print(f"    record: {json.dumps(record(verifier, statement, w))}")
    print()
    print("  runs are free. Nothing above was scored or recorded.")
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


def command_classify(arguments: list[str]) -> int:
    if not progress.classify_unlocked():
        print("the classification is not open yet.")
        print()
        _print_status()
        print()
        print("  naming what a verifier breaks is worth nothing until a break has been")
        print("  produced -- that is the whole point of this problem. Clear reject,")
        print("  recover and forge, then `review show` prints the line to type.")
        return 1
    return _stage_command("classify", arguments, check_classify)


def command_transfer(arguments: list[str]) -> int:
    if not progress.transfer_unlocked():
        print("the second panel has not been handed over yet.")
        print()
        _print_status()
        print()
        print("  it is the same three questions on statements you have not seen, and it")
        print("  is only worth anything once the first panel has been done the slow way.")
        print("  Clear the four stages above, then `review show` prints the second panel.")
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
        print("  the flag is released once all five are cleared. `review show` restates the")
        print("  statements and the exact command for each stage, `review run` lets you")
        print("  test a candidate for free, and every stage says what is not satisfied")
        print("  without handing over the answer.")
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
    "run": command_run,
    "reject": lambda arguments: _stage_command("reject", arguments, check_reject),
    "recover": lambda arguments: _stage_command("recover", arguments, check_recover),
    "forge": lambda arguments: _stage_command("forge", arguments, check_forge),
    "classify": command_classify,
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
