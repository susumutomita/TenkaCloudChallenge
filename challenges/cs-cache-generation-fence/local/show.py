"""Print this deployment's evidence without printing checkpoint answers."""

from __future__ import annotations

import json
import os

from fixtures.generate import audit_trace, health_token, race_evidence


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    rows, _answer = audit_trace(seed)
    print("cs-cache-generation-fence")
    print("Prerequisite: Python dictionaries and functions.")
    print("origin = source of truth; revision = committed version number")
    print("fill = origin value returning after a cache miss")
    print(f"environment: {health_token(seed)}")
    print("\nRace timeline:")
    print(json.dumps(race_evidence(seed), ensure_ascii=False, indent=2))
    print("\nDecision log for audit (answer is not marked):")
    print(json.dumps([{"index": index, **row} for index, row in enumerate(rows)], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
