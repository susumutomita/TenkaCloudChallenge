"""`make inspect` — the seeded evidence, and the question it is evidence for.

The shape here is the shape the Portal serves from `/api/inspect`; both build it from
`evidence()` below, and `scripts/cs-foundations-evidence.test.ts` asserts the two are
identical. The vocabulary that used to be printed only as a CLI header now travels
inside the payload, so the browser gets it too.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import QUESTIONS, STALE_RULE, audit_trace, health_token, race_evidence


def evidence(seed: str) -> dict[str, object]:
    """Everything a participant may see. Contains no expected answer."""
    rows = audit_trace(seed)
    return {
        "environment": {"healthToken": health_token(seed)},
        "race": {**QUESTIONS["race"], **race_evidence(seed)},
        "audit": {
            **QUESTIONS["audit"],
            "rule": STALE_RULE,
            "events": [{"index": index, **row} for index, row in enumerate(rows)],
        },
    }


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    print(json.dumps(evidence(seed), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
