"""Print participant-visible evidence, never the answer."""

from __future__ import annotations

import json
import os

from fixtures.generate import evidence_blocks


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    print(json.dumps(evidence_blocks(seed), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
