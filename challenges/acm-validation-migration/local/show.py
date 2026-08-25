"""Print participant-visible evidence, never expected answers."""

from __future__ import annotations

import json
import os

from fixtures.aws_lab import QUESTIONS, inventory_snapshot


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    evidence = {
        "inventory": {
            **QUESTIONS["inventory"],
            "account": inventory_snapshot(seed),
        }
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
