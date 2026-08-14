"""`make inspect` — the seeded evidence, and the question it is evidence for.

The shape here is the shape the Portal serves from `/api/inspect`. Both read
`QUESTIONS` from `fixtures.generate`, and `scripts/cs-foundations-evidence.test.ts`
asserts the two payloads are identical, so a participant sees the same thing whether
they solve in the terminal or in the browser.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import QUESTIONS, audit_evidence, health_token

GATE = "asyncio.Future values are released explicitly; no sleep or network is used"


def evidence(seed: str) -> dict[str, object]:
    """Everything a participant may see. Contains no expected answer."""
    return {
        "environment": {"healthToken": health_token(seed), "gate": GATE},
        "audit": {**QUESTIONS["audit"], **audit_evidence(seed)},
    }


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    print(json.dumps(evidence(seed), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
