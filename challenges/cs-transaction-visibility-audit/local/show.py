"""`make inspect` — seeded evidence for the two direct-answer checkpoints.

The shape here is the shape the Portal serves from `/api/inspect`; both build it from
`evidence()` below, and `scripts/cs-foundations-evidence.test.ts` asserts the two are
identical. The Portal used to serve this file's stdout as one English text blob, which
made the browser copy readable only to English readers and impossible to render as
structured evidence.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import QUESTIONS, audit_fixture, counterexample_fixture

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def evidence(seed: str) -> dict[str, object]:
    """Everything a participant may see. Contains no expected answer."""
    audit = audit_fixture(seed)
    counterexample = counterexample_fixture(seed)
    return {
        "audit": {
            **QUESTIONS["audit"],
            "committed": audit["committed"],
            "reports": audit["reports"],
            "note": "committed states preserve the total; every report row was committed when read.",
        },
        "counterexample": {
            **QUESTIONS["counterexample"],
            "readOrder": counterexample["readOrder"],
            "commitAfterRead": counterexample["commitAfterRead"],
            "candidates": counterexample["candidates"],
        },
    }


def main() -> None:
    print(json.dumps(evidence(SEED), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
