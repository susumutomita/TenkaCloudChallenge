"""Print participant-visible evidence, never expected answers."""

from __future__ import annotations

import json
import os

from fixtures.generate import QUESTIONS, audit_log, dropped_response_trace, health_token, public_operation


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    rows = audit_log(seed)
    evidence = {
        "environment": {"healthToken": health_token(seed)},
        "uncertain": {
            "operation": public_operation(seed),
            "firstAttempt": dropped_response_trace(seed)[0],
            **QUESTIONS["uncertain"],
        },
        "audit": {
            **QUESTIONS["audit"],
            "brokenGatewayTrace": dropped_response_trace(seed),
            "ledger": [{"index": index, **row} for index, row in enumerate(rows)],
        },
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
