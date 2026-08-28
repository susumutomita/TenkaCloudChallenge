"""Print participant-visible evidence, never expected answers."""

from __future__ import annotations

import json
import os

from fixtures.generate import QUESTIONS, daily_ledger, health_token, shipped_report


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    evidence = {
        "environment": {"healthToken": health_token(seed)},
        "observe": {
            **QUESTIONS["observe"],
            "report": shipped_report(seed),
            "ledger": [{"index": index, **row} for index, row in enumerate(daily_ledger(seed))],
        },
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
