"""Public tests: the round trip on one setting, plus the shape of the line split. That is all.

They never ask whether a partial set of shares hides anything, nor whether one point
of the line does -- the only properties that make secret sharing worth doing. The
hidden verifier does.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from participant.public_checks import check  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's modulus, party count and drawn randomness -- what `show.py`
    prints, plus the secret this file has always had to hand `share()` to check a round
    trip at all.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module's `reference_shares` builds a correct split of this
    deployment's secret, and it shipped in the same image as
    `tests/hidden/check_sharing.py`, so it does not ship in the `participant` Docker
    stage at all any more (see ../../Dockerfile). This deployment's own verifier is the
    only source for the public half now: `PUBLIC_EVIDENCE_JSON` when the Portal has
    already fetched it, or `VERIFIER_PUBLIC_URL` fetched directly when it has not.
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
    # scripts/ac26-w2-secret-sharing.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def main() -> int:
    source = (ROOT / "starter/sharing.py").read_text()
    result = check(source, _load_public_evidence())
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index+1] if index+1 < len(sys.argv) else ""
    if only:
        lines = [line for line in result["output"].splitlines()
                 if line.startswith(("PASS ", "FAIL ")) and only in line]
        if not lines:
            print("No public test matched, or sharing.py could not run.")
            print(result["output"])
            return 1
        print("\n".join(lines))
        return 1 if any(line.startswith("FAIL ") for line in lines) else 0
    print(result["output"])
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
