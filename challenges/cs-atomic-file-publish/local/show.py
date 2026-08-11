"""Print participant-visible evidence, never expected answers."""

from __future__ import annotations

import json
import os

from fixtures.generate import crash_survivors, health_token, published_document, reader_observations


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    observations = reader_observations(seed)
    evidence = {
        "environment": {"healthToken": health_token(seed)},
        "observe": {
            "document": published_document(seed),
            "readerLog": observations[:4],
            "question": (
                "The writer reported success and the bytes on disk are correct. "
                "What could this reader have been holding at t+120ms?"
            ),
        },
        "audit": {
            "readerLog": [{"index": index, **row} for index, row in enumerate(observations)],
            "crashSurvivors": crash_survivors(seed),
        },
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
