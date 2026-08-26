"""Public tests. They show the shape of an answer; they do not prove one correct.

They commit, ask, open, and verify. Once. They never present a leaf from the wrong index,
never flip a sibling's side, never take the steps out of order, and never ask what the
commitment would be worth if the query came first.

An implementation whose leaves do not bind their index passes this file completely.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import commit as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict[str, object]:
    """This deployment's vector, query, and root -- the same things `show.py` prints.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module also implements `node_hash` under the exact name the
    starter's own `node_hash` stub asks the learner to write, so it does not ship in
    the `participant` Docker stage at all any more (see ../../Dockerfile). This
    deployment's own verifier is the only source for the public half now:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
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
    # scripts/ac26-w4-commit-open.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def check_root_matches() -> str:
    cfg = PUBLIC["setting"]
    if submission.merkle_root(list(cfg["values"])).hex() != PUBLIC["rootHex"]:
        return "the root does not match the committed vector"
    return ""


def check_an_honest_opening_verifies() -> str:
    cfg = PUBLIC["setting"]
    values, index = list(cfg["values"]), cfg["query"]
    root = submission.merkle_root(values)
    path = submission.open_at(values, index)
    if not submission.verify_opening(root, index, values[index], path, cfg["length"]):
        return "an honest opening did not verify"
    return ""


CHECKS = (
    ("root-matches", check_root_matches),
    ("an-honest-opening-verifies", check_an_honest_opening_verifies),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here tried to cheat, and cheating is what the checkpoints test.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
