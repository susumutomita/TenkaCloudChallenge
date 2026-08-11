"""Print participant-visible evidence, never expected answers.

The payload itself is built by ``fixtures.generate.evidence``, which the Workbench
also calls. Keeping one builder is deliberate: when this file carried its own copy,
the question text existed here and never reached the Portal at all.
"""

from __future__ import annotations

import json
import os

from fixtures.generate import evidence


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    print(json.dumps(evidence(seed), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
