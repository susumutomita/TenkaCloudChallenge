"""Public tests. They show the shape of an answer; they do not prove one correct.

Deliberately thin. They run your auditor against ONE program -- the clean one -- and
check the two easiest things: that `allowed_opens` returns labels, and that a run with
nothing wrong in it is not reported as a violation.

That is not enough and is not meant to be. Nothing here feeds you a leaking program, a
log line carrying a public value, a party reading its own slot, a renamed protocol, or
a repair. The hidden tests do all of those. If you only satisfy this file, you have
written an auditor that says "fine" to everything.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import auditor  # noqa: E402
from fixtures.generate import execute, program, spec, spec_as_public  # noqa: E402

SEED = __import__("os").environ.get("FLAG_SEED", "local-dev-seed")


def check_allowed_opens_is_not_empty() -> str:
    sp = spec(SEED)
    got = auditor.allowed_opens(spec_as_public(sp))
    if not isinstance(got, list) or not got:
        return "allowed_opens returned no labels"
    if any(not isinstance(item, str) for item in got):
        return "allowed_opens returned something that is not a label"
    return ""


def check_clean_run_is_not_flagged() -> str:
    sp = spec(SEED)
    run = execute(program(sp, "alpha"), sp)
    if auditor.first_violation(run.events, spec_as_public(sp)) is not None:
        return "a run that leaks nothing was reported as a violation"
    return ""


CHECKS = (
    ("allowed-opens-is-not-empty", check_allowed_opens_is_not_empty),
    ("clean-run-is-not-flagged", check_clean_run_is_not_flagged),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        message = check()
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNote what is absent: no leaking program, no renamed protocol, no repair.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
