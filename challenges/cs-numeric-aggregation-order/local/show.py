"""Print participant-visible evidence, never expected answers."""

from __future__ import annotations

import json
import os

from fixtures.generate import allocation_sheet, disputed_report, health_token, reconciliation_runs


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    runs = reconciliation_runs(seed)
    evidence = {
        "environment": {"healthToken": health_token(seed)},
        "observe": {
            "report": disputed_report(seed),
            "runs": runs[:4],
            "question": (
                "The same line items were totalled several times. "
                "What does a disagreement between two of these runs prove?"
            ),
        },
        "audit": {
            "runs": [{"index": index, **row} for index, row in enumerate(runs)],
            "allocationSheet": allocation_sheet(seed),
        },
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
