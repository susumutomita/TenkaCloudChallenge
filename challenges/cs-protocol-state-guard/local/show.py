"""Print participant-visible evidence, never expected answers."""

from __future__ import annotations

import json
import os

from fixtures.generate import HAPPY_PATH, health_token, reported_session, session_transcript


def main() -> None:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    transcript = session_transcript(seed)
    evidence = {
        "environment": {"healthToken": health_token(seed)},
        "observe": {
            "session": reported_session(seed),
            "documentedOrder": list(HAPPY_PATH),
            "transcript": transcript[:3],
            "question": "Every reply here says ok. What did the server let this client do?",
        },
        "audit": {
            "documentedOrder": list(HAPPY_PATH),
            "transcript": [{"index": index, **row} for index, row in enumerate(transcript)],
        },
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
