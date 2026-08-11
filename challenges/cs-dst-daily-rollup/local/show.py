"""Print participant-visible evidence, never expected answers."""

from __future__ import annotations

import json
import os

from fixtures.generate import daily_report, health_token, reported_zone


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    report = daily_report(seed)
    zone = reported_zone(seed)
    evidence = {
        "environment": {"healthToken": health_token(seed)},
        "observe": {
            "report": {key: zone[key] for key in ("reportId", "timezone")},
            "rows": report[:4],
            "question": (
                "The job did not change and the ledger did not change. "
                "What is different about the day the totals stopped matching?"
            ),
        },
        "audit": {
            "timezone": zone["timezone"],
            "rows": [{"index": index, **row} for index, row in enumerate(report)],
        },
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
