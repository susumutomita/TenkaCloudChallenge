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

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import auditor  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's specification and the one clean run's trace -- what `show.py`
    prints, and the only two things this file has ever needed.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module's `TRUTH` names the verdict for each of the seven programs by
    id, and it shipped in the same image as `tests/hidden/check_auditor.py`, whose
    `_expected_index` and `_leaks` state the decision rule `first_violation` exists to
    make a learner derive -- so it does not ship in the `participant` Docker stage at all
    any more (see ../../Dockerfile). This deployment's own verifier is the only source
    for the public half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched
    it, or `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w2-privacy-audit.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def check_allowed_opens_is_not_empty() -> str:
    got = auditor.allowed_opens(dict(PUBLIC["spec"]))
    if not isinstance(got, list) or not got:
        return "allowed_opens returned no labels"
    if any(not isinstance(item, str) for item in got):
        return "allowed_opens returned something that is not a label"
    return ""


def check_clean_run_is_not_flagged() -> str:
    if auditor.first_violation(list(PUBLIC["cleanEvents"]), dict(PUBLIC["spec"])) is not None:
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
